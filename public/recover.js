/* Blank-screen recovery watchdog.
 *
 * Loaded from index.html at a STABLE url (/recover.js) so it runs even when the
 * main app bundle does not — e.g. a stale service worker served an index.html
 * that references a JS chunk the cache no longer has, so the entry script fails
 * and #root stays empty. The existing in-bundle handlers only catch *dynamic*
 * import failures, not the entry script, so this is the belt-and-braces net.
 *
 * If the app hasn't mounted after a few seconds, unregister the service worker,
 * clear caches, and reload once (guarded against reload loops) so the browser
 * fetches the current build fresh. Normal loads mount in well under a second, so
 * this never fires for them.
 */
(function () {
  var GUARD = 'sp_recover_attempts';
  function mounted() {
    var r = document.getElementById('root');
    return !!(r && r.children.length > 0);
  }
  setTimeout(function () {
    try {
      if (mounted()) { try { sessionStorage.removeItem(GUARD); } catch (e) {} return; }
      var n = 0;
      try { n = parseInt(sessionStorage.getItem(GUARD) || '0', 10) || 0; } catch (e) {}
      if (n >= 2) return; // genuine failure — stop, don't reload-loop
      try { sessionStorage.setItem(GUARD, String(n + 1)); } catch (e) {}
      var reload = function () { location.reload(); };
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations()
          .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
          .then(function () {
            return (window.caches && caches.keys)
              ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
              : null;
          })
          .then(reload, reload);
      } else {
        reload();
      }
    } catch (e) { /* ignore */ }
  }, 5000);
})();
