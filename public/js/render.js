/* Shared overlay renderer (editor + public scene). No dependencies.
 * To add an overlay type: add an entry to TYPES (and to lib/types.js on the server). */
(function (root) {
  'use strict';

  var FONTS = {
    sans: 'system-ui, "Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Courier New", monospace',
    display: 'Impact, "Arial Black", sans-serif'
  };
  // Cross-origin overlays keep their own origin so their cookies/storage work. If a URL points back
  // at this app, never combine allow-scripts with allow-same-origin (that would defeat the sandbox).
  var SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

  function isHttpUrl(s) {
    try { var u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
  }
  function sameOrigin(s) {
    try { return new URL(s, location.href).origin === location.origin; } catch (e) { return true; }
  }
  function frame(src, sandbox) {
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', sandbox);
    f.setAttribute('allow', 'autoplay; fullscreen; clipboard-write');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('scrolling', 'no');
    f.src = src;
    return f;
  }

  var TYPES = {
    iframe: {
      label: 'Browser source', icon: '\u{1F310}',
      defaults: { width: 640, height: 360, source: '', props: {} },
      fields: [{ key: 'source', label: 'URL', kind: 'url' }],
      build: function (el) {
        if (!isHttpUrl(el.source)) return null;
        return frame(el.source, sameOrigin(el.source) ? 'allow-scripts' : SANDBOX);
      }
    },
    image: {
      label: 'Image', icon: '\u{1F5BC}',
      defaults: { width: 400, height: 300, source: '', props: { fit: 'contain' } },
      fields: [
        { key: 'source', label: 'Image URL', kind: 'url' },
        { key: 'props.fit', label: 'Fit', kind: 'select', options: ['contain', 'cover', 'fill'] }
      ],
      build: function (el) {
        if (!isHttpUrl(el.source)) return null;
        var i = document.createElement('img');
        i.draggable = false;
        i.alt = '';
        i.referrerPolicy = 'no-referrer';
        i.style.objectFit = (el.props && el.props.fit) || 'contain';
        i.src = el.source;
        return i;
      }
    },
    text: {
      label: 'Text', icon: 'T',
      defaults: { width: 600, height: 120, source: 'Your text', props: { color: '#ffffff', fontSize: 64, fontWeight: 'bold', fontFamily: 'sans', align: 'left', shadow: true } },
      fields: [
        { key: 'source', label: 'Text', kind: 'textarea' },
        { key: 'props.color', label: 'Color', kind: 'color' },
        { key: 'props.fontSize', label: 'Font size', kind: 'number', min: 6, max: 600 },
        { key: 'props.fontWeight', label: 'Weight', kind: 'select', options: ['normal', 'bold'] },
        { key: 'props.fontFamily', label: 'Font', kind: 'select', options: Object.keys(FONTS) },
        { key: 'props.align', label: 'Align', kind: 'select', options: ['left', 'center', 'right'] },
        { key: 'props.shadow', label: 'Shadow', kind: 'checkbox' }
      ],
      build: function (el) {
        var p = el.props || {};
        var d = document.createElement('div');
        d.className = 'txt';
        d.textContent = el.source; // textContent: never parsed as HTML
        d.style.color = p.color || '#fff';
        d.style.fontSize = (p.fontSize || 48) + 'px';
        d.style.fontWeight = p.fontWeight || 'normal';
        d.style.fontFamily = FONTS[p.fontFamily] || FONTS.sans;
        d.style.textAlign = p.align || 'left';
        if (p.shadow) d.style.textShadow = '0 2px 6px rgba(0,0,0,.65)';
        return d;
      }
    },
    html: {
      label: 'HTML widget', icon: '</>',
      defaults: { width: 480, height: 270, source: '<div style="color:#fff;font:700 40px sans-serif">Hello</div>', props: {} },
      fields: [{ key: 'source', label: 'HTML', kind: 'textarea', commit: 'change' }],
      // Served from /widget/... inside a CSP sandbox (opaque origin). o.widgetUrl(el) supplies the URL.
      build: function (el, o) {
        return frame(o.widgetUrl(el), 'allow-scripts');
      }
    }
  };

  function layoutSig(el) {
    return [el.x, el.y, el.width, el.height, el.rotation, el.opacity, el.zIndex].join('|');
  }

  function update(node, el, o) {
    var lay = layoutSig(el);
    if (node._lay !== lay) {
      node._lay = lay;
      var s = node.style;
      s.left = el.x + 'px';
      s.top = el.y + 'px';
      s.width = el.width + 'px';
      s.height = el.height + 'px';
      s.transform = el.rotation ? 'rotate(' + el.rotation + 'deg)' : '';
      s.opacity = el.opacity;
      s.zIndex = el.zIndex;
    }
    var sig = el.type + '\n' + el.source + '\n' + JSON.stringify(el.props || {});
    if (node._sig !== sig) {
      node._sig = sig;
      node.textContent = '';
      var t = TYPES[el.type];
      var inner = t && t.build(el, o);
      if (inner) node.appendChild(inner);
    }
  }

  function create(el, o) {
    var n = document.createElement('div');
    n.className = 'ov';
    n.dataset.id = el.id;
    update(n, el, o);
    return n;
  }

  root.OverlayRender = { TYPES: TYPES, FONTS: FONTS, create: create, update: update, isHttpUrl: isHttpUrl };
})(window);
