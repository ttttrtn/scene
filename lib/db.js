'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { normalizeElement, num, str, bad } = require('./types');

// DATA_DIR must point at a Render persistent disk (e.g. /var/data) for data to survive deploys.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'scenes.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS scenes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  width      INTEGER NOT NULL DEFAULT 1920,
  height     INTEGER NOT NULL DEFAULT 1080,
  background TEXT NOT NULL DEFAULT 'transparent',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS elements (
  id        TEXT NOT NULL,
  scene_id  TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  name      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT '',
  props     TEXT NOT NULL DEFAULT '{}',
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 200, height REAL NOT NULL DEFAULT 100,
  rotation REAL NOT NULL DEFAULT 0,
  opacity REAL NOT NULL DEFAULT 1,
  z_index INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scene_id, id)
);
CREATE INDEX IF NOT EXISTS idx_elements_scene ON elements(scene_id, z_index);
`);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function genId(n = 10) {
  const b = crypto.randomBytes(n);
  let s = '';
  for (const x of b) s += ALPHABET[x % 36];
  return s;
}

const q = {
  list: db.prepare(`SELECT s.id, s.name, s.width, s.height, s.updated_at AS updatedAt, s.created_at AS createdAt,
                    (SELECT COUNT(*) FROM elements e WHERE e.scene_id = s.id) AS elementCount
                    FROM scenes s ORDER BY s.updated_at DESC`),
  scene: db.prepare(`SELECT id, name, width, height, background, version, created_at AS createdAt, updated_at AS updatedAt FROM scenes WHERE id = ?`),
  elements: db.prepare(`SELECT * FROM elements WHERE scene_id = ? ORDER BY z_index ASC, rowid ASC`),
  insScene: db.prepare(`INSERT INTO scenes (id, name, width, height, background, version, created_at, updated_at) VALUES (@id, @name, @width, @height, @background, 1, @now, @now)`),
  updScene: db.prepare(`UPDATE scenes SET name=@name, width=@width, height=@height, background=@background, version=version+1, updated_at=@now WHERE id=@id`),
  delEls: db.prepare(`DELETE FROM elements WHERE scene_id = ?`),
  insEl: db.prepare(`INSERT INTO elements (id, scene_id, type, name, source, props, x, y, width, height, rotation, opacity, z_index, visible, locked)
                     VALUES (@id, @sceneId, @type, @name, @source, @props, @x, @y, @width, @height, @rotation, @opacity, @zIndex, @visible, @locked)`),
  delScene: db.prepare(`DELETE FROM scenes WHERE id = ?`),
  widget: db.prepare(`SELECT source FROM elements WHERE scene_id = ? AND id = ? AND type = 'html'`)
};

function rowToElement(r) {
  let props = {};
  try { props = JSON.parse(r.props); } catch { /* ignore */ }
  return {
    id: r.id, sceneId: r.scene_id, type: r.type, name: r.name, source: r.source, props,
    x: r.x, y: r.y, width: r.width, height: r.height, rotation: r.rotation, opacity: r.opacity,
    zIndex: r.z_index, visible: !!r.visible, locked: !!r.locked
  };
}

const listScenes = () => q.list.all();
const sceneExists = (id) => !!q.scene.get(id);

function getScene(id) {
  const s = q.scene.get(id);
  if (!s) return null;
  return { ...s, elements: q.elements.all(id).map(rowToElement) };
}

// Public view: only visible elements. HTML widget source is replaced by a short hash
// (the iframe loads it from /widget/...), which keeps public payloads small.
function getPublicScene(id) {
  const s = q.scene.get(id);
  if (!s) return null;
  const elements = q.elements.all(id).filter((r) => r.visible).map((r) => {
    const el = rowToElement(r);
    if (el.type === 'html') el.source = crypto.createHash('md5').update(el.source).digest('hex').slice(0, 10);
    delete el.sceneId;
    return el;
  });
  return { id: s.id, name: s.name, width: s.width, height: s.height, background: s.background, version: s.version, elements };
}

function getWidgetHtml(sceneId, id) {
  const r = q.widget.get(sceneId, id);
  return r ? r.source : null;
}

function cleanBackground(v, d) { return /^#[0-9a-f]{6}$/i.test(v) ? v : (v === 'transparent' ? v : d); }

function createScene(name) {
  const id = genId(10);
  const now = Date.now();
  q.insScene.run({ id, name: str(name, 80).trim() || 'New Scene', width: 1920, height: 1080, background: 'transparent', now });
  return getScene(id);
}

const saveTx = db.transaction((id, body) => {
  const cur = q.scene.get(id);
  if (!cur) return null;
  const list = Array.isArray(body.elements) ? body.elements : [];
  if (list.length > 200) throw bad('Too many elements (max 200)');
  const els = list.map(normalizeElement);
  if (new Set(els.map((e) => e.id)).size !== els.length) throw bad('Duplicate element ids');
  q.updScene.run({
    id,
    name: str(body.name, 80).trim() || cur.name,
    width: Math.round(num(body.width, cur.width, 100, 7680)),
    height: Math.round(num(body.height, cur.height, 100, 7680)),
    background: cleanBackground(body.background, cur.background),
    now: Date.now()
  });
  q.delEls.run(id);
  for (const e of els) q.insEl.run({ ...e, sceneId: id });
  return q.scene.get(id);
});
const saveScene = (id, body) => saveTx(id, body || {});

const dupTx = db.transaction((id) => {
  const s = getScene(id);
  if (!s) return null;
  const nid = genId(10);
  const now = Date.now();
  q.insScene.run({ id: nid, name: (s.name + ' (copy)').slice(0, 80), width: s.width, height: s.height, background: s.background, now });
  for (const e of s.elements) {
    q.insEl.run({ ...e, id: 'e' + genId(10), sceneId: nid, props: JSON.stringify(e.props), visible: e.visible ? 1 : 0, locked: e.locked ? 1 : 0 });
  }
  return getScene(nid);
});
const duplicateScene = (id) => dupTx(id);

const deleteScene = (id) => q.delScene.run(id).changes > 0;

module.exports = { listScenes, sceneExists, getScene, getPublicScene, getWidgetHtml, createScene, saveScene, duplicateScene, deleteScene, DATA_DIR };
