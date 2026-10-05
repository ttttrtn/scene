'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./lib/db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render terminates TLS in front of the app

const PORT = process.env.PORT || 3000; // Render injects PORT (default 10000)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ---------- security helpers ---------- */

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// Protects the dashboard, editor and admin API. Public scene routes never use this.
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next(); // open mode (local development)
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (safeEq(user, ADMIN_USER) && safeEq(rest.join(':'), ADMIN_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Scene Builder", charset="UTF-8"');
  res.status(401).send('Authentication required');
}

// Forces a CORS preflight for cross-site requests, which blocks CSRF against the admin API.
function requireXhr(req, res, next) {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'scenebuilder') {
    return res.status(403).json({ error: 'Missing X-Requested-With header' });
  }
  next();
}

// Pages only run our own scripts. Overlays are cross-origin iframes (frame-src *).
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'",
  'img-src * data: blob:', 'media-src * data: blob:', 'font-src * data:',
  'frame-src *', "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"
].join('; ');

function sendView(file, embeddable) {
  const full = path.join(__dirname, 'views', file);
  return (req, res) => {
    // Dashboard/editor refuse to be framed (clickjacking); the public scene may be embedded anywhere.
    res.set('Content-Security-Policy', embeddable ? CSP : CSP + "; frame-ancestors 'self'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(full);
  };
}

const validId = (id) => /^[a-z0-9]{6,32}$/.test(id);
function idParam(req, res, next, id) {
  if (!validId(id)) return res.status(404).json({ error: 'Not found' });
  next();
}
app.param('id', idParam);
app.param('sceneId', idParam);

/* ---------- live updates (Server-Sent Events) ---------- */

const clients = new Map(); // sceneId -> Set<res>
function broadcast(sceneId, payload, event) {
  const set = clients.get(sceneId);
  if (!set) return;
  const msg = (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(msg);
}
// Keep proxies from closing idle streams.
setInterval(() => {
  for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
}, 20000);

/* ---------- public routes (no login) ---------- */

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/scene/:id', sendView('scene.html', true));

app.get('/api/public/scenes/:id', (req, res) => {
  const scene = db.getPublicScene(req.params.id);
  res.set('Cache-Control', 'no-store');
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  if (Number(req.query.since) === scene.version) return res.json({ version: scene.version, unchanged: true });
  res.json(scene);
});

app.get('/api/public/scenes/:id/events', (req, res) => {
  const id = req.params.id;
  if (!db.sceneExists(id)) return res.status(404).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  let set = clients.get(id);
  if (!set) clients.set(id, (set = new Set()));
  set.add(res);
  req.on('close', () => {
    set.delete(res);
    if (!set.size) clients.delete(id);
  });
});

// HTML widgets are served from their own URL in a CSP sandbox: scripts run, but with an opaque
// origin, so they cannot touch the scene page, the editor, or this app's cookies and storage.
app.get('/widget/:sceneId/:elId', (req, res) => {
  const html = /^[A-Za-z0-9_-]{4,40}$/.test(req.params.elId) ? db.getWidgetHtml(req.params.sceneId, req.params.elId) : null;
  if (html == null) return res.status(404).type('text').send('Not found');
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': 'sandbox allow-scripts',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.send('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style>' + html);
});

/* ---------- admin pages and API ---------- */

app.get('/', requireAdmin, sendView('dashboard.html'));
app.get('/editor/:id', requireAdmin, sendView('editor.html'));

const api = express.Router();
const jsonSmall = express.json({ limit: '2mb' });
api.use(requireAdmin, requireXhr, (req, res, next) => (req.path === '/import' ? next() : jsonSmall(req, res, next)));
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

api.get('/export', (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="scenes.json"');
  res.json(db.exportAll());
});
api.post('/import', express.json({ limit: '20mb' }), (req, res) => {
  const n = db.importAll(req.body, req.query.replace === '1');
  res.json({ imported: n });
});
api.get('/storage', (req, res) => res.json(db.STORAGE));
api.get('/scenes', (req, res) => res.json(db.listScenes()));
api.post('/scenes', (req, res) => res.status(201).json(db.createScene(req.body && req.body.name)));
api.get('/scenes/:id', (req, res) => {
  const s = db.getScene(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Scene not found' });
});
api.put('/scenes/:id', (req, res) => {
  const s = db.saveScene(req.params.id, req.body);
  if (!s) return res.status(404).json({ error: 'Scene not found' });
  broadcast(s.id, { v: s.version });
  res.json({ version: s.version, updatedAt: s.updatedAt });
});
api.post('/scenes/:id/duplicate', (req, res) => {
  const s = db.duplicateScene(req.params.id);
  s ? res.status(201).json(s) : res.status(404).json({ error: 'Scene not found' });
});
api.delete('/scenes/:id', (req, res) => {
  const id = req.params.id;
  if (!db.deleteScene(id)) return res.status(404).json({ error: 'Scene not found' });
  broadcast(id, {}, 'gone');
  res.json({ ok: true });
});
app.use('/api', api);

/* ---------- static assets and errors ---------- */

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scene Builder listening on ${PORT} (data: ${db.DATA_DIR})`);
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set. The dashboard and editor are open to anyone who can reach this server.');
});
