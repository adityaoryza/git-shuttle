/* Talking to the server about what the page remembers (see prefs.js). */
import { api } from "./api.js";
import { isMirrored, mergeStored } from "./prefs.js";

export async function loadPrefs() {
  try { return (await api("GET", "prefs")).prefs || {}; } catch (e) { return {}; }      // without them the page works, it only forgets
}
export function savePref(key, value) {
  return api("POST", "prefs", { key, value }).then(r => r.prefs, () => null);
}

// Brings the settings back into the storage before the page is drawn, and from then on sends every change of a "shuttle." setting to the server.
let timer = null;
const pending = new Map();
function flush() {
  timer = null;
  for (const [key, value] of pending) savePref("ls:" + key, value);
  pending.clear();
}
function mirror(key, value) {
  if (!isMirrored(key)) return;
  pending.set(key, value);
  if (!timer) timer = setTimeout(flush, 300);
}
export async function syncStorage() {
  const prefs = await loadPrefs();
  let upload = {};
  const original = Storage.prototype.setItem;
  try { upload = mergeStored(prefs, localStorage, (k, v) => original.call(localStorage, k, v)); } catch (e) { /* no storage: nothing to bring back */ }
  for (const [key, value] of Object.entries(upload)) mirror(key, value);
  try {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) { original.call(this, key, value); if (this === localStorage) mirror(key, String(value)); };
    Storage.prototype.removeItem = function (key) { remove.call(this, key); if (this === localStorage) mirror(key, null); };
  } catch (e) { /* the settings are then kept in the browser only */ }
  return prefs;
}
