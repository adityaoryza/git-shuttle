/* The theme: "light" or "dark". A saved choice always wins; without one, the system setting is used once and not saved.
 * The pure parts are tested with node. */

export const THEMES = ["light", "dark"];
const KEY = "shuttle.theme";

export function otherTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

// The saved choice, or null when there is none (or the storage is not available).
export function savedTheme(storage) {
  try { const value = storage.getItem(KEY); return THEMES.includes(value) ? value : null; } catch (e) { return null; }
}

export function systemTheme(matchMedia) {
  try { return matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { return "light"; }
}

export function currentTheme(storage, matchMedia) {
  return savedTheme(storage) || systemTheme(matchMedia);
}

// Puts the theme on <html>; `remember` also saves it (a click does, the first visit does not).
export function applyTheme(theme, root, storage, remember) {
  root.setAttribute("data-theme", theme);
  if (!remember) return;
  try { storage.setItem(KEY, theme); } catch (e) { /* the choice is not kept */ }
}
