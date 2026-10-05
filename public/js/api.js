/* Tiny fetch helper for the admin API + shared UI utilities. */
(function (root) {
  'use strict';
  function api(method, url, body, opts) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'scenebuilder' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: !!(opts && opts.keepalive)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Request failed (' + r.status + ')'); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  function sceneUrl(id, qs) { return location.origin + '/scene/' + id + (qs || ''); }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      t.remove();
    });
  }

  var toastTimer;
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'show' + (isError ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2200);
  }

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  root.UI = { api: api, sceneUrl: sceneUrl, copyText: copyText, toast: toast, h: h };
})(window);
