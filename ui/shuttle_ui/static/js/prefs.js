/* What the page remembers (the branches hidden from the graph, how the branch list was left, the repository you were on): it is kept by the
 * server, not in the browser, whose storage is per address and port. Pure helpers, tested with node. */
const list = text => { try { const v = JSON.parse(text || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch (e) { return []; } };

// The references hidden in one repository: what the server keeps, else what this browser kept before the server did (migrate: it is to be
// sent to the server once).
export function hiddenFor(prefs, id, storage) {
  const kept = prefs && prefs["hidden:" + id];
  if (Array.isArray(kept)) return { hidden: new Set(kept), migrate: false };
  let old = [];
  try { old = list(storage && storage.getItem("shuttle.hidden." + id)); } catch (e) { old = []; }
  return { hidden: new Set(old), migrate: old.length > 0 };
}

// How the branch list was left, with the defaults for what was never saved or is damaged.
export function pickerFrom(prefs) {
  const kept = (prefs && prefs.picker) || {};
  const sections = { Local: true, Remote: false, ...(kept.sections && typeof kept.sections === "object" ? kept.sections : {}) };
  return { sections: { Local: sections.Local !== false, Remote: sections.Remote === true }, closed: new Set(Array.isArray(kept.closed) ? kept.closed.filter(x => typeof x === "string") : []) };
}
export const pickerToPref = (sections, closed) => ({ sections: { Local: !!sections.Local, Remote: !!sections.Remote }, closed: [...closed].sort() });

// -- the other settings of the page (theme, widths of the columns, sizes of the panes, filters...): they keep working as they are, in the storage
// of the browser, and a copy is kept by the server, which brings them back at another address (another port: another storage).
export const isMirrored = key => typeof key === "string" && /^shuttle\.[A-Za-z0-9._:-]{1,80}$/.test(key) && !key.startsWith("shuttle.hidden.");

// What the server kept is put in the storage (it wins); what only the storage has is returned, to be sent to the server (a first time).
export function mergeStored(prefs, storage, set) {
  const put = set || ((k, v) => storage.setItem(k, v));
  const server = {};
  for (const [key, value] of Object.entries(prefs || {})) if (key.startsWith("ls:") && typeof value === "string" && isMirrored(key.slice(3))) server[key.slice(3)] = value;
  for (const [key, value] of Object.entries(server)) { try { put(key, value); } catch (e) { /* storage full or blocked */ } }
  const upload = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (isMirrored(key) && !(key in server)) upload[key] = storage.getItem(key);
    }
  } catch (e) { /* storage blocked */ }
  return upload;
}
