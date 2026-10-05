'use strict';
// Server-side element type registry: validates and normalizes each overlay type.
// To add a new overlay type, add an entry here and a matching entry in public/js/render.js.

const FONTS = ['sans', 'serif', 'mono', 'display'];

function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function num(v, d, min, max) { v = Number(v); if (!Number.isFinite(v)) v = d; return Math.min(max, Math.max(min, v)); }
function str(v, max) { return String(v == null ? '' : v).slice(0, max); }
function oneOf(v, list, d) { return list.includes(v) ? v : d; }

function httpUrl(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (v.length > 2048) throw bad('URL is too long');
  let u;
  try { u = new URL(v); } catch { throw bad('Invalid URL: ' + v.slice(0, 80)); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Only http and https URLs are allowed');
  return u.href;
}

const TYPES = {
  iframe: { label: 'Browser source', source: httpUrl, props: () => ({}) },
  image: {
    label: 'Image', source: httpUrl,
    props: (p) => ({ fit: oneOf(p.fit, ['contain', 'cover', 'fill'], 'contain') })
  },
  text: {
    label: 'Text', source: (v) => str(v, 5000),
    props: (p) => ({
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#ffffff',
      fontSize: Math.round(num(p.fontSize, 48, 6, 600)),
      fontWeight: oneOf(p.fontWeight, ['normal', 'bold'], 'normal'),
      fontFamily: oneOf(p.fontFamily, FONTS, 'sans'),
      align: oneOf(p.align, ['left', 'center', 'right'], 'left'),
      shadow: !!p.shadow
    })
  },
  html: { label: 'HTML widget', source: (v) => str(v, 100000), props: () => ({}) }
};

function normalizeElement(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Invalid element');
  const type = TYPES[raw.type];
  if (!type) throw bad('Unknown element type: ' + str(raw.type, 20));
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(raw.id))) throw bad('Invalid element id');
  return {
    id: String(raw.id),
    type: raw.type,
    name: str(raw.name, 80).trim() || type.label,
    source: type.source(raw.source),
    props: JSON.stringify(type.props(raw.props && typeof raw.props === 'object' ? raw.props : {})),
    x: num(raw.x, 0, -20000, 20000),
    y: num(raw.y, 0, -20000, 20000),
    width: num(raw.width, 200, 1, 20000),
    height: num(raw.height, 100, 1, 20000),
    rotation: num(raw.rotation, 0, -360, 360),
    opacity: num(raw.opacity, 1, 0, 1),
    zIndex: Math.round(num(raw.zIndex, 0, -1000, 100000)),
    visible: raw.visible === false ? 0 : 1,
    locked: raw.locked ? 1 : 0
  };
}

module.exports = { TYPES, normalizeElement, num, str, bad };
