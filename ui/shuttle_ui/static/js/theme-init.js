/* Runs before the page is drawn (a plain script, not a module): puts the theme on <html>, so there is no flash.
 * A saved choice wins; without one the system setting is used, and nothing is saved until the button is clicked. */
(function () {
  var theme = null;
  try {
    var saved = localStorage.getItem("shuttle.theme");
    if (saved === "dark" || saved === "light") theme = saved;
  } catch (e) { /* storage is not available */ }
  if (!theme) {
    try { theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { theme = "light"; }
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
