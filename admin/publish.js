/* ============================================================
   NELVA admin: "Publish to website" (shared by the dashboard /admin/ and the editor /admin/editor/)

   Saving in the admin does not deploy (commits use [skip netlify]); publishing starts ONE Netlify
   build through a build hook. The hook address is created in Netlify (Project configuration ->
   Build & deploy -> Build hooks) and pasted once per browser; it is kept in localStorage.
   ============================================================ */
window.nelvaPublish = (function () {
  var KEY = 'nelva_build_hook';
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  function getHook() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function askHook() {
    var url = prompt('One-time setup: paste the Publish link your developer gave you\n(it starts with https://api.netlify.com/build_hooks/)');
    if (!url) return '';
    url = url.trim();
    if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[a-z0-9]+$/i.test(url)) {
      alert('That doesn’t look like the Publish link. Please copy it again.');
      return '';
    }
    try { localStorage.setItem(KEY, url); } catch (e) { /* private mode */ }
    return url;
  }

  /** Publishes after asking. onStatus(title, detail, state) where state is 'busy' | 'done' | 'error' | 'local'.
      Returns a promise that resolves true when a build was started. */
  return function publish(onStatus) {
    onStatus = onStatus || function () {};
    if (isLocal) {
      onStatus('Test mode on this computer', 'Nothing is published from here.', 'local');
      return Promise.resolve(false);
    }
    var hook = getHook() || askHook();
    if (!hook) return Promise.resolve(false);
    if (!confirm('Put all your saved changes on the website now?\n\n' +
      'The website updates in about 1–2 minutes. Each publish uses part of the monthly allowance, ' +
      'so publish once when you have finished.')) return Promise.resolve(false);
    onStatus('Publishing…', 'Please wait a moment.', 'busy');
    return fetch(hook, { method: 'POST', mode: 'no-cors' })
      .then(function () {
        onStatus('Publishing started ✓', 'The website will be updated in about 1–2 minutes.', 'done');
        return true;
      })
      .catch(function () {
        onStatus('Could not reach Netlify', 'Check your internet connection and try again.', 'error');
        return false;
      });
  };
})();
