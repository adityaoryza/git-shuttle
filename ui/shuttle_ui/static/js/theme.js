/* The theme: "system" (the default), "light" or "dark", remembered in the browser. Pure parts are tested with node. */

export const THEMES = ["system", "light", "dark"];

export function nextTheme(current) {
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
}

export function readTheme(storage) {
  try { const v = storage.getItem("shuttle.theme"); return THEMES.includes(v) ? v : "system"; } catch (e) { return "system"; }
}

// Puts the theme on <html> ("system" removes the attribute) and remembers it.
export function applyTheme(theme, root, storage) {
  if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
  try { if (theme === "system") storage.removeItem("shuttle.theme"); else storage.setItem("shuttle.theme", theme); } catch (e) { /* not remembered */ }
}
