// ARBS-H UI1b: apply the saved theme (localStorage "arbs.theme") before the app loads.
(function () {
  var pref = 'system';
  try {
    var saved = window.localStorage.getItem('arbs.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') pref = saved;
  } catch (e) {
    /* storage disabled */
  }
  var dark = pref === 'dark';
  if (pref === 'system') {
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      dark = false;
    }
  }
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
