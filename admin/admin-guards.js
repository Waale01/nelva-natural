/* ============================================================
   NELVA admin: safety checks when saving

   Categories: before saving Shop settings -> Categories, warn if a category that still has
   products was deleted (or its short code changed, which has the same effect). Cancelling
   stops the save, so nothing changes.

   Product counts come from the published homepage (product cards and category tiles), so a
   product added but not yet published is not counted.
   ============================================================ */
(function () {
  if (!window.CMS || !CMS.registerEventListener) return;

  function toJS(v) { return v && typeof v.toJS === 'function' ? v.toJS() : v; }

  // Products per category from the published homepage
  function loadCounts() {
    return fetch('/index.html?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (!html) return null;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var counts = {};
        var names = {};
        doc.querySelectorAll('#productGrid .product-card[data-category]').forEach(function (c) {
          counts[c.dataset.category] = (counts[c.dataset.category] || 0) + 1;
        });
        doc.querySelectorAll('.category-tile[data-category]').forEach(function (t) {
          var h3 = t.querySelector('h3');
          names[t.dataset.category] = h3 ? h3.textContent : t.dataset.category;
        });
        return { counts: counts, names: names };
      })
      .catch(function () { return null; });
  }

  CMS.registerEventListener({
    name: 'preSave',
    handler: function (args) {
      var entry = args && args.entry;
      if (!entry || entry.get('collection') !== 'settings' || entry.get('slug') !== 'categories') return undefined;
      var data = entry.get('data');
      var kept = (toJS(data && data.get('categories')) || []).map(function (c) { return c && c.id; });

      return loadCounts().then(function (info) {
        if (!info) return data; // can't check (offline): don't block the save
        var removed = Object.keys(info.counts).filter(function (id) { return kept.indexOf(id) === -1; });
        if (!removed.length) return data;

        var lines = removed.map(function (id) {
          var n = info.counts[id];
          return '• ' + (info.names[id] || id) + ': ' + n + ' product' + (n === 1 ? '' : 's');
        }).join('\n');
        var ok = window.confirm(
          'These categories still have products:\n\n' + lines + '\n\n' +
          'If you delete them (or change their short code), those products disappear from the shop’s category filters ' +
          'until you move them to another category.\n\n' +
          'To rename a category, only change its Name.\n\n' +
          'Save anyway? Click Cancel to go back without saving.'
        );
        if (!ok) throw new Error('Not saved: categories with products were not deleted.');
        return data;
      });
    },
  });
})();
