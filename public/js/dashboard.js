(function () {
  'use strict';
  var UI = window.UI, h = UI.h;
  var grid = document.getElementById('sceneGrid');

  function fmt(ms) { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

  function card(s) {
    var url = UI.sceneUrl(s.id);
    return h('article', { class: 'scene-card' }, [
      h('div', { class: 'scene-top' }, [
        h('h3', { text: s.name }),
        h('span', { class: 'chip', text: s.id })
      ]),
      h('p', { class: 'muted', text: s.elementCount + (s.elementCount === 1 ? ' element' : ' elements') + ' \u00b7 ' + s.width + '\u00d7' + s.height + ' \u00b7 updated ' + fmt(s.updatedAt) }),
      h('label', { class: 'url-label' }, ['Public scene URL', h('input', { class: 'url-box', type: 'text', readonly: true, value: url, onfocus: function (e) { e.target.select(); } })]),
      h('div', { class: 'row' }, [
        h('a', { class: 'btn primary', href: '/editor/' + s.id, text: 'Edit' }),
        h('button', { class: 'btn', text: 'Copy URL', onclick: function () { UI.copyText(url).then(function () { UI.toast('URL copied'); }, function () { UI.toast('Could not copy. Select the URL and copy it manually.', true); }); } }),
        h('a', { class: 'btn', href: url + '?preview=true', target: '_blank', rel: 'noopener', text: 'Open scene' }),
        h('button', { class: 'btn', text: 'Duplicate', onclick: function () { UI.api('POST', '/api/scenes/' + s.id + '/duplicate').then(load, function (e) { UI.toast(e.message, true); }); } }),
        h('button', { class: 'btn danger', text: 'Delete', onclick: function () {
          if (confirm('Delete "' + s.name + '"? Its public URL will stop working.')) UI.api('DELETE', '/api/scenes/' + s.id).then(load, function (e) { UI.toast(e.message, true); });
        } })
      ])
    ]);
  }

  function load() {
    return UI.api('GET', '/api/scenes').then(function (list) {
      grid.textContent = '';
      if (!list.length) grid.appendChild(h('p', { class: 'empty', text: 'No scenes yet. Name one above and click Create scene.' }));
      list.forEach(function (s) { grid.appendChild(card(s)); });
    }, function (e) { UI.toast(e.message, true); });
  }

  document.getElementById('newForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('newName');
    UI.api('POST', '/api/scenes', { name: input.value.trim() || 'New Scene' }).then(function (s) {
      location.href = '/editor/' + s.id;
    }, function (err) { UI.toast(err.message, true); });
  });

  load();
})();
