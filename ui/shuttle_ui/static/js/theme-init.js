/* Runs before the page is drawn (a plain script, not a module): puts the chosen theme on <html>, so there is no flash.
 * No value, or "system", leaves it to the system setting. js/theme.js changes it afterwards. */
(function () {
  try {
    var theme = localStorage.getItem("shuttle.theme");
    if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
  } catch (e) { /* storage is not available: the system setting decides */ }
})();
