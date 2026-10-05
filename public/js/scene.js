/* Public scene runtime: renders saved elements and applies live updates. No libraries. */
(function () {
  'use strict';
  var R = window.OverlayRender;
  var id = location.pathname.split('/').filter(Boolean)[1];
  var params = new URLSearchParams(location.search);
  var preview = params.get('preview') === 'true';
  var forceTransparent = params.get('transparent') === 'true';
  var rootEl = document.getElementById('scene');
  var nodes = new Map();
  var version = 0;
  var size = { w: 1920, h: 1080 };
  var loading = false, pending = false;

  if (preview) document.documentElement.classList.add('preview');

  var opts = { widgetUrl: function (el) { return '/widget/' + id + '/' + el.id + '?h=' + el.source; } };

  function fit() {
    if (!preview) return;
    var s = Math.min(innerWidth / size.w, innerHeight / size.h);
    rootEl.style.transform = 'translate(' + (innerWidth - size.w * s) / 2 + 'px,' + (innerHeight - size.h * s) / 2 + 'px) scale(' + s + ')';
  }
  addEventListener('resize', fit);

  function clear() {
    nodes.forEach(function (n) { n.remove(); });
    nodes.clear();
  }

  function apply(data) {
    version = data.version;
    size = { w: data.width, h: data.height };
    rootEl.style.width = data.width + 'px';
    rootEl.style.height = data.height + 'px';
    rootEl.style.background = forceTransparent ? 'transparent' : data.background;
    fit();
    var seen = new Set();
    data.elements.forEach(function (el) {
      seen.add(el.id);
      var n = nodes.get(el.id);
      if (!n) { n = R.create(el, opts); nodes.set(el.id, n); rootEl.appendChild(n); } else { R.update(n, el, opts); }
    });
    nodes.forEach(function (n, k) { if (!seen.has(k)) { n.remove(); nodes.delete(k); } });
  }

  // Only changed elements are touched; unchanged iframes are never reloaded.
  function load() {
    if (loading) { pending = true; return; }
    loading = true;
    fetch('/api/public/scenes/' + id + '?since=' + version, { cache: 'no-store' })
      .then(function (r) { if (r.status === 404) { clear(); return null; } return r.json(); })
      .then(function (d) { if (d && !d.unchanged) apply(d); })
      .catch(function () {})
      .then(function () { loading = false; if (pending) { pending = false; load(); } });
  }

  load();
  if (window.EventSource) {
    var es = new EventSource('/api/public/scenes/' + id + '/events');
    es.onmessage = load;
    es.onopen = load; // catch up after a reconnect
    es.addEventListener('gone', function () { clear(); });
  } else {
    setInterval(load, 5000); // fallback: cheap version check, only applies when the version changed
  }
})();
