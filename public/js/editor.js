/* Scene editor. Vanilla JS, no libraries. */
(function () {
  'use strict';
  var UI = window.UI, h = UI.h, R = window.OverlayRender;
  var id = location.pathname.split('/').filter(Boolean)[1];
  var $ = function (i) { return document.getElementById(i); };

  var scene = null;       // { name, width, height, background }
  var els = [];           // element objects (same shape the server stores)
  var sel = null;         // selected element id
  var scale = 1;
  var nodes = new Map();  // element id -> DOM node
  var canvas = $('canvas'), layer = $('layer'), selbox = $('selbox'), wrap = $('stageWrap'), sizer = $('stageSize');
  var gV = canvas.querySelector('.gl.v'), gH = canvas.querySelector('.gl.hz');

  function djb2(s) { var x = 5381; for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); }
  var opts = { widgetUrl: function (el) { return '/widget/' + id + '/' + el.id + '?h=' + djb2(el.source); } };
  var uid = function () { return 'e' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36); };
  var get = function (eid) { for (var i = 0; i < els.length; i++) if (els[i].id === eid) return els[i]; return null; };
  var ordered = function () { return els.slice().sort(function (a, b) { return a.zIndex - b.zIndex; }); };
  var maxZ = function () { return els.reduce(function (m, e) { return Math.max(m, e.zIndex); }, 0); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ================= saving ================= */

  var rev = 0, savedRev = 0, saving = false, timer = null, firstDirty = 0;
  var statusEl = $('saveStatus');
  var LABELS = { saved: 'Saved \u2713', saving: 'Saving\u2026', unsaved: 'Unsaved changes', error: 'Save failed' };
  function setStatus(kind, msg) { statusEl.className = 'status ' + kind; statusEl.textContent = msg || LABELS[kind]; }
  function payload() { return { name: scene.name, width: scene.width, height: scene.height, background: scene.background, elements: els }; }

  function schedule(delay) { clearTimeout(timer); timer = setTimeout(flush, delay); }
  function markDirty() {
    rev++;
    setStatus('unsaved');
    if (!firstDirty) firstDirty = Date.now();
    // Debounce 600 ms after the last change, but never wait more than 2.5 s while dragging continuously.
    schedule(Math.max(0, Math.min(600, firstDirty + 2500 - Date.now())));
  }
  function flush() {
    if (saving || rev === savedRev) return Promise.resolve();
    saving = true; firstDirty = 0;
    var mine = rev;
    setStatus('saving');
    return UI.api('PUT', '/api/scenes/' + id, payload()).then(function () {
      saving = false; savedRev = mine;
      if (rev !== savedRev) { setStatus('unsaved'); schedule(300); } else setStatus('saved');
    }, function (err) {
      saving = false;
      if (err.status && err.status < 500) { setStatus('error', 'Save failed: ' + err.message); return; } // fix the input, then edit again
      setStatus('error', 'Save failed. Retrying\u2026');
      schedule(3000);
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && rev !== savedRev) UI.api('PUT', '/api/scenes/' + id, payload(), { keepalive: true }).catch(function () {});
  });
  addEventListener('beforeunload', function (e) { if (rev !== savedRev) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= canvas ================= */

  function syncNode(el) {
    var n = nodes.get(el.id);
    if (!n) { n = R.create(el, opts); nodes.set(el.id, n); layer.appendChild(n); } else R.update(n, el, opts);
    n.style.display = el.visible ? '' : 'none';
    n.classList.toggle('locked', !!el.locked);
  }
  function renderAll() {
    var live = new Set(els.map(function (e) { return e.id; }));
    nodes.forEach(function (n, k) { if (!live.has(k)) { n.remove(); nodes.delete(k); } });
    els.forEach(syncNode);
  }

  function layout() {
    if (!scene) return;
    var r = wrap.getBoundingClientRect();
    scale = Math.max(0.05, Math.min((r.width - 48) / scene.width, (r.height - 48) / scene.height));
    sizer.style.width = scene.width * scale + 'px';
    sizer.style.height = scene.height * scale + 'px';
    canvas.style.width = scene.width + 'px';
    canvas.style.height = scene.height + 'px';
    canvas.style.transform = 'scale(' + scale + ')';
    canvas.style.setProperty('--inv', String(1 / scale));
    $('zoomInfo').textContent = scene.width + '\u00d7' + scene.height + ' \u00b7 ' + Math.round(scale * 100) + '%';
    positionSel();
  }
  function applyBackground() {
    var t = scene.background === 'transparent';
    canvas.classList.toggle('checker', t);
    canvas.style.background = t ? '' : scene.background;
  }
  new ResizeObserver(layout).observe(wrap);

  function positionSel() {
    var el = get(sel);
    if (!el || !el.visible) { selbox.hidden = true; return; }
    selbox.hidden = false;
    var s = selbox.style;
    s.left = el.x + 'px'; s.top = el.y + 'px'; s.width = el.width + 'px'; s.height = el.height + 'px';
    s.transform = el.rotation ? 'rotate(' + el.rotation + 'deg)' : '';
    selbox.classList.toggle('locked', !!el.locked);
  }

  // handles
  [['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0]].forEach(function (d) {
    var hd = h('div', { class: 'handle h-' + d[0] });
    hd.addEventListener('pointerdown', function (e) { var el = get(sel); if (el && !el.locked && e.button === 0) startDrag(e, 'resize', el, d[1], d[2]); });
    selbox.appendChild(hd);
  });
  var rot = h('div', { class: 'handle rot', title: 'Rotate (hold Shift to snap to 15\u00b0)' });
  rot.addEventListener('pointerdown', function (e) { var el = get(sel); if (el && !el.locked && e.button === 0) startDrag(e, 'rotate', el); });
  selbox.appendChild(rot);

  wrap.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('.handle')) return;
    var n = e.target.closest('.ov');
    if (!n) { select(null); return; }
    var el = get(n.dataset.id);
    if (!el) return;
    select(el.id);
    if (!el.locked) startDrag(e, 'move', el);
  });

  /* ---- dragging ---- */
  var drag = null;
  function startDrag(e, mode, el, hx, hy) {
    e.preventDefault();
    drag = { mode: mode, id: el.id, sx: e.clientX, sy: e.clientY, hx: hx, hy: hy, o: { x: el.x, y: el.y, w: el.width, h: el.height, r: el.rotation } };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', endDrag);
    addEventListener('pointercancel', endDrag);
  }
  function endDrag() {
    drag = null;
    gV.style.display = gH.style.display = 'none';
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', endDrag);
    removeEventListener('pointercancel', endDrag);
  }
  function toCanvas(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; }

  // Snap the element's left/center/right (and top/middle/bottom) to the canvas and to other elements.
  function snapMove(nx, ny, w, hh, selfId) {
    var th = 8 / scale, xs = [0, scene.width / 2, scene.width], ys = [0, scene.height / 2, scene.height];
    els.forEach(function (o) {
      if (o.id === selfId || !o.visible) return;
      xs.push(o.x, o.x + o.width / 2, o.x + o.width);
      ys.push(o.y, o.y + o.height / 2, o.y + o.height);
    });
    function best(pos, size, lines) {
      var res = null;
      [pos, pos + size / 2, pos + size].forEach(function (m) {
        lines.forEach(function (c) { var d = c - m; if (Math.abs(d) <= th && (!res || Math.abs(d) < Math.abs(res.d))) res = { d: d, line: c }; });
      });
      return res;
    }
    var bx = best(nx, w, xs), by = best(ny, hh, ys);
    return { x: nx + (bx ? bx.d : 0), y: ny + (by ? by.d : 0), gx: bx ? bx.line : null, gy: by ? by.line : null };
  }

  function onMove(e) {
    if (!drag) return;
    var el = get(drag.id);
    if (!el) return;
    var o = drag.o, dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale;
    if (drag.mode === 'move') {
      var nx = o.x + dx, ny = o.y + dy;
      gV.style.display = gH.style.display = 'none';
      if (!e.altKey) { // hold Alt to move without snapping
        var sn = snapMove(nx, ny, o.w, o.h, el.id);
        nx = sn.x; ny = sn.y;
        if (sn.gx != null) { gV.style.left = sn.gx + 'px'; gV.style.display = 'block'; }
        if (sn.gy != null) { gH.style.top = sn.gy + 'px'; gH.style.display = 'block'; }
      }
      el.x = Math.round(nx); el.y = Math.round(ny);
    } else if (drag.mode === 'resize') {
      var th = o.r * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      var lx = dx * c + dy * s, ly = -dx * s + dy * c; // pointer delta in the element's own (rotated) axes
      var nw = Math.max(10, o.w + drag.hx * lx), nh = Math.max(10, o.h + drag.hy * ly);
      if (e.shiftKey && drag.hx && drag.hy) { var k = Math.max(nw / o.w, nh / o.h); nw = Math.max(10, o.w * k); nh = Math.max(10, o.h * k); }
      var cl = { x: drag.hx * (nw - o.w) / 2, y: drag.hy * (nh - o.h) / 2 }; // keep the opposite edge fixed
      var cx = o.x + o.w / 2 + cl.x * c - cl.y * s, cy = o.y + o.h / 2 + cl.x * s + cl.y * c;
      el.width = Math.round(nw); el.height = Math.round(nh);
      el.x = Math.round(cx - nw / 2); el.y = Math.round(cy - nh / 2);
    } else {
      var p = toCanvas(e);
      var a = Math.atan2(p.y - (o.y + o.h / 2), p.x - (o.x + o.w / 2)) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      el.rotation = Math.round((((a + 540) % 360) - 180) * 10) / 10;
    }
    touch(el);
  }

  /* ================= element operations ================= */

  function touch(el, relist) {
    syncNode(el);
    positionSel();
    syncProps();
    if (relist) renderList();
    markDirty();
  }

  function addElement(type, name, source) {
    var t = R.TYPES[type], d = clone(t.defaults);
    var el = {
      id: uid(), type: type, name: name || t.label, source: source != null ? source : d.source, props: d.props,
      x: Math.round((scene.width - d.width) / 2), y: Math.round((scene.height - d.height) / 2), width: d.width, height: d.height,
      rotation: 0, opacity: 1, zIndex: maxZ() + 1, visible: true, locked: false
    };
    els.push(el);
    syncNode(el);
    select(el.id);
    markDirty();
    if (type === 'image' && source) { // size to the image's natural proportions
      var im = new Image();
      im.onload = function () {
        if (!get(el.id) || !im.naturalWidth) return;
        var k = Math.min(1, scene.width * 0.5 / im.naturalWidth, scene.height * 0.5 / im.naturalHeight);
        el.width = Math.max(10, Math.round(im.naturalWidth * k)); el.height = Math.max(10, Math.round(im.naturalHeight * k));
        el.x = Math.round((scene.width - el.width) / 2); el.y = Math.round((scene.height - el.height) / 2);
        touch(el);
      };
      im.src = source;
    }
    return el;
  }
  function removeElement(eid) {
    var el = get(eid);
    if (!el || !confirm('Delete "' + el.name + '"?')) return;
    els = els.filter(function (e) { return e.id !== eid; });
    renderAll();
    if (sel === eid) sel = null;
    select(sel);
    markDirty();
  }
  function duplicateElement(el) {
    var c = clone(el);
    c.id = uid(); c.name = (el.name + ' copy').slice(0, 80); c.x += 20; c.y += 20; c.zIndex = maxZ() + 1;
    els.push(c);
    syncNode(c);
    select(c.id);
    markDirty();
  }
  function reorder(dragged, target, before) {
    var a = ordered().filter(function (e) { return e.id !== dragged; });
    var d = get(dragged);
    var idx = a.findIndex(function (e) { return e.id === target; });
    a.splice(before ? idx + 1 : idx, 0, d); // list is shown front-first, so "before" means higher z
    a.forEach(function (e, i) { e.zIndex = i + 1; });
    renderAll(); renderList(); syncProps(); markDirty();
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || $('addDialog').open) return;
    var el = get(sel);
    if (!el) return;
    if (e.key === 'Delete') { e.preventDefault(); removeElement(el.id); }
    else if (e.key === 'Escape') select(null);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(el); }
    else if (/^Arrow/.test(e.key) && !el.locked) {
      var st = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') el.x -= st; else if (e.key === 'ArrowRight') el.x += st;
      else if (e.key === 'ArrowUp') el.y -= st; else el.y += st;
      e.preventDefault(); touch(el);
    }
  });

  /* ================= sidebar ================= */

  var listEl = $('layerList'), dragId = null;
  function renderList() {
    listEl.textContent = '';
    var arr = ordered().reverse();
    if (!arr.length) { listEl.appendChild(h('li', { class: 'empty', text: 'No elements yet. Click Add overlay to start.' })); return; }
    arr.forEach(function (el) {
      var icon = (R.TYPES[el.type] || {}).icon || '';
      var li = h('li', { class: 'layer' + (el.id === sel ? ' sel' : '') + (el.visible ? '' : ' off'), draggable: 'true', 'data-id': el.id, onclick: function () { select(el.id); } }, [
        h('span', { class: 'grip', text: '\u22ee\u22ee', title: 'Drag to reorder' }),
        h('button', { class: 'ib' + (el.visible ? '' : ' dim'), title: el.visible ? 'Hide' : 'Show', 'aria-label': 'Toggle visibility', text: '\u{1F441}',
          onclick: function (e) { e.stopPropagation(); el.visible = !el.visible; touch(el, true); renderProps(); } }),
        h('button', { class: 'ib' + (el.locked ? '' : ' dim'), title: el.locked ? 'Unlock' : 'Lock', 'aria-label': 'Toggle lock', text: el.locked ? '\u{1F512}' : '\u{1F513}',
          onclick: function (e) { e.stopPropagation(); el.locked = !el.locked; touch(el, true); renderProps(); } }),
        h('span', { class: 'lname', text: icon + ' ' + el.name }),
        h('button', { class: 'ib', title: 'Delete', 'aria-label': 'Delete element', text: '\u{1F5D1}', onclick: function (e) { e.stopPropagation(); removeElement(el.id); } })
      ]);
      li.addEventListener('dragstart', function (e) { dragId = el.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.id); });
      li.addEventListener('dragover', function (e) {
        if (!dragId) return;
        e.preventDefault();
        var r = li.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
        li.classList.toggle('drop-before', before); li.classList.toggle('drop-after', !before);
      });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-before', 'drop-after'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        var r = li.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2, d = dragId;
        dragId = null;
        if (d && d !== el.id) reorder(d, el.id, before); else renderList();
      });
      li.addEventListener('dragend', function () { dragId = null; renderList(); });
      listEl.appendChild(li);
    });
  }

  function select(eid) {
    sel = eid && get(eid) ? eid : null;
    renderList(); renderProps(); positionSel();
  }

  /* ================= properties panel ================= */

  var propsEl = $('props');
  function getVal(el, key) { return key.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, el); }
  function setVal(el, key, v) {
    var p = key.split('.'), o = el;
    for (var i = 0; i < p.length - 1; i++) { if (!o[p[i]] || typeof o[p[i]] !== 'object') o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = v;
  }

  // spec: { key, label, kind: number|text|url|textarea|select|color|checkbox, min, max, step, mul, options, commit, relist }
  function fieldFor(el, f) {
    var input;
    if (f.kind === 'select') {
      input = h('select', {}, f.options.map(function (o) { return h('option', { value: o, text: o }); }));
    } else if (f.kind === 'textarea') {
      input = h('textarea', { rows: '5', spellcheck: 'false' });
    } else if (f.kind === 'checkbox') {
      input = h('input', { type: 'checkbox' });
    } else {
      input = h('input', { type: f.kind === 'number' ? 'number' : (f.kind === 'color' ? 'color' : 'text'), min: f.min, max: f.max, step: f.step });
    }
    input.dataset.key = f.key;
    if (f.mul) input.dataset.mul = f.mul;
    var v = getVal(el, f.key);
    if (f.kind === 'checkbox') input.checked = !!v;
    else if (typeof v === 'number') input.value = String(Math.round(v * (f.mul || 1) * 100) / 100);
    else input.value = v == null ? '' : v;

    var evt = (f.commit === 'change' || f.kind === 'url') ? 'change' : 'input';
    input.addEventListener(evt, function () {
      var val;
      if (f.kind === 'checkbox') val = input.checked;
      else if (f.kind === 'number') {
        val = parseFloat(input.value);
        if (!isFinite(val)) return;
        if (f.min != null) val = Math.max(f.min, val);
        if (f.max != null) val = Math.min(f.max, val);
        val = val / (f.mul || 1);
      } else if (f.kind === 'url') {
        val = input.value.trim();
        var ok = val === '' || R.isHttpUrl(val);
        input.classList.toggle('invalid', !ok);
        if (!ok) { UI.toast('URLs must start with http:// or https://', true); return; }
      } else val = input.value;
      setVal(el, f.key, val);
      touch(el, f.relist);
    });
    var wrapEl = h('label', { class: 'field' + (f.kind === 'checkbox' ? ' check' : '') }, f.kind === 'checkbox' ? [input, h('span', { text: f.label })] : [h('span', { text: f.label }), input]);
    return wrapEl;
  }

  function syncProps() {
    var el = get(sel);
    if (!el) return;
    propsEl.querySelectorAll('[data-key]').forEach(function (i) {
      if (i === document.activeElement) return;
      var v = getVal(el, i.dataset.key);
      if (i.type === 'checkbox') i.checked = !!v;
      else if (typeof v === 'number') i.value = String(Math.round(v * (+i.dataset.mul || 1) * 100) / 100);
      else i.value = v == null ? '' : v;
    });
  }

  function renderProps() {
    propsEl.textContent = '';
    var el = get(sel);
    if (!el) return renderScenePanel();
    var type = R.TYPES[el.type];
    var num = function (key, label, min, max, extra) { return fieldFor(el, Object.assign({ key: key, label: label, kind: 'number', min: min, max: max }, extra || {})); };
    propsEl.appendChild(h('div', { class: 'panel-head' }, [h('h2', { text: type.label })]));
    propsEl.appendChild(fieldFor(el, { key: 'name', label: 'Name', kind: 'text', relist: true }));
    propsEl.appendChild(h('div', { class: 'two' }, [num('x', 'X', -20000, 20000), num('y', 'Y', -20000, 20000), num('width', 'Width', 1, 20000), num('height', 'Height', 1, 20000)]));
    propsEl.appendChild(h('div', { class: 'two' }, [num('rotation', 'Rotation (\u00b0)', -360, 360), num('opacity', 'Opacity (%)', 0, 100, { mul: 100 }), num('zIndex', 'Z-index', -1000, 100000, { relist: true })]));
    propsEl.appendChild(h('div', { class: 'two' }, [
      fieldFor(el, { key: 'locked', label: 'Locked', kind: 'checkbox', relist: true }),
      fieldFor(el, { key: 'visible', label: 'Visible', kind: 'checkbox', relist: true })
    ]));
    propsEl.appendChild(h('h3', { text: 'Content' }));
    type.fields.forEach(function (f) { propsEl.appendChild(fieldFor(el, f)); });
    propsEl.appendChild(h('div', { class: 'row top' }, [
      h('button', { class: 'btn', type: 'button', text: 'Duplicate', onclick: function () { duplicateElement(el); } }),
      h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () { removeElement(el.id); } })
    ]));
    propsEl.appendChild(h('p', { class: 'hint', text: 'Arrow keys nudge 1 px (Shift: 10 px). Hold Alt while dragging to turn snapping off. Hold Shift while resizing a corner to keep proportions.' }));
  }

  function renderScenePanel() {
    var url = UI.sceneUrl(id);
    propsEl.appendChild(h('div', { class: 'panel-head' }, [h('h2', { text: 'Scene settings' })]));
    var wIn = h('input', { type: 'number', min: '100', max: '7680', value: String(scene.width) });
    var hIn = h('input', { type: 'number', min: '100', max: '7680', value: String(scene.height) });
    function dim() {
      var w = parseInt(wIn.value, 10), hh = parseInt(hIn.value, 10);
      if (!(w >= 100 && hh >= 100)) return;
      scene.width = Math.min(7680, w); scene.height = Math.min(7680, hh);
      layout(); markDirty();
    }
    wIn.addEventListener('input', dim); hIn.addEventListener('input', dim);
    propsEl.appendChild(h('div', { class: 'two' }, [h('label', { class: 'field' }, [h('span', { text: 'Width' }), wIn]), h('label', { class: 'field' }, [h('span', { text: 'Height' }), hIn])]));

    var solid = scene.background !== 'transparent';
    var mode = h('select', {}, [h('option', { value: 'transparent', text: 'Transparent' }), h('option', { value: 'solid', text: 'Solid color' })]);
    mode.value = solid ? 'solid' : 'transparent';
    var color = h('input', { type: 'color', value: solid ? scene.background : '#000000' });
    color.hidden = !solid;
    function bg() { scene.background = mode.value === 'solid' ? color.value : 'transparent'; color.hidden = mode.value !== 'solid'; applyBackground(); markDirty(); }
    mode.addEventListener('change', bg); color.addEventListener('input', bg);
    propsEl.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Background (OBS shows transparent as see-through)' }), mode, color]));

    var box = h('input', { type: 'text', readonly: true, value: url, onfocus: function (e) { e.target.select(); } });
    propsEl.appendChild(h('div', { class: 'url-panel' }, [
      h('div', { class: 'lbl', text: 'Public scene URL' }), box,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', type: 'button', text: 'Copy URL', onclick: copyUrl }),
        h('button', { class: 'btn', type: 'button', text: 'Open scene', onclick: openPreview })
      ])
    ]));
    propsEl.appendChild(h('details', { open: true }, [
      h('summary', { text: 'OBS Browser Source' }),
      h('ol', {}, [
        h('li', { text: 'Copy the public scene URL.' }), h('li', { text: 'Open OBS.' }), h('li', { text: 'Add a Browser source.' }),
        h('li', { text: 'Paste the URL.' }), h('li', { text: 'Set width to ' + scene.width + ' and height to ' + scene.height + '.' }),
        h('li', { text: 'Leave custom CSS alone. The scene is already transparent.' }), h('li', { text: 'Click OK. Edits here appear in OBS without a refresh.' })
      ])
    ]));
    propsEl.appendChild(h('p', { class: 'hint', text: 'Click an element on the canvas or in the list to edit it.' }));
  }

  function copyUrl() { UI.copyText(UI.sceneUrl(id)).then(function () { UI.toast('Scene URL copied'); }, function () { UI.toast('Could not copy. Select the URL and copy it manually.', true); }); }
  function openPreview() { flush(); window.open(UI.sceneUrl(id, '?preview=true'), '_blank', 'noopener'); }
  $('btnCopy').addEventListener('click', copyUrl);
  $('btnPreview').addEventListener('click', openPreview);

  $('sceneName').addEventListener('input', function (e) {
    scene.name = e.target.value.slice(0, 80);
    document.title = (scene.name || 'Scene') + ' \u00b7 Scene Builder';
    markDirty();
  });

  /* ================= add overlay dialog ================= */

  var dlg = $('addDialog'), addType = 'iframe';
  var HINTS = {
    iframe: 'Paste the full URL of any overlay or widget page. Some sites block being embedded in an iframe; those will show blank.',
    image: 'Paste a direct link to a PNG, GIF, JPG or WebP. Transparent PNGs keep their transparency.',
    text: 'Plain text. You can change color, size and font after adding it.',
    html: 'Your own HTML, CSS and JavaScript. It runs in an isolated sandbox and cannot reach the rest of the page.'
  };
  function setAddType(t) {
    addType = t;
    dlg.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.type === t); });
    var useUrl = t === 'iframe' || t === 'image';
    $('fUrl').hidden = !useUrl; $('fText').hidden = useUrl;
    $('addUrlLabel').textContent = t === 'image' ? 'Image URL' : 'Overlay URL';
    $('addTextLabel').textContent = t === 'html' ? 'HTML' : 'Text';
    $('addText').value = '';
    $('addText').placeholder = t === 'html' ? '<div style="color:white;font:700 40px sans-serif">Hello</div>' : 'Your text';
    $('addHint').textContent = HINTS[t];
    $('addErr').textContent = '';
  }
  dlg.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { setAddType(b.dataset.type); }); });
  $('btnAdd').addEventListener('click', function () {
    $('addName').value = ''; $('addUrl').value = ''; setAddType('iframe'); dlg.showModal(); $('addUrl').focus();
  });
  $('addCancel').addEventListener('click', function () { dlg.close(); });
  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('addName').value.trim(), source;
    if (addType === 'iframe' || addType === 'image') {
      source = $('addUrl').value.trim();
      if (!R.isHttpUrl(source)) { $('addErr').textContent = 'Enter a full URL that starts with http:// or https://'; return; }
      if (!name) { try { name = new URL(source).hostname.replace(/^www\./, ''); } catch (x) { /* keep default */ } }
    } else {
      source = $('addText').value;
      if (addType === 'text' && !source.trim()) source = 'Your text';
    }
    addElement(addType, name, source);
    dlg.close();
  });

  /* ================= boot ================= */

  UI.api('GET', '/api/scenes/' + id).then(function (data) {
    scene = { name: data.name, width: data.width, height: data.height, background: data.background };
    els = data.elements;
    $('sceneName').value = scene.name;
    document.title = scene.name + ' \u00b7 Scene Builder';
    applyBackground(); renderAll(); layout(); renderList(); renderProps();
  }, function (err) {
    document.body.textContent = '';
    document.body.style.display = 'block';
    document.body.appendChild(h('p', { class: 'fatal' }, [err.status === 404 ? 'This scene does not exist. ' : 'Could not load the scene: ' + err.message + ' ', h('a', { href: '/', text: 'Back to scenes' })]));
  });
})();
