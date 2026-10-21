/* The arithmetic of a resizable table: widths, which columns fit, sorting, and what is remembered. Pure, tested with node.
 *
 * A column is { key, label, min, max, width, priority, align, sortable, required, flex }. `priority` says what to keep when the table is
 * narrow: the lowest goes first. A `required` column is never hidden (without any, the first column is). The `flex` column (without
 * one, the last visible column) takes whatever room is left, so the table never needs a horizontal scroll bar.
 */

export const PREFS_VERSION = 1;
const prefsKey = id => "shuttle.table." + PREFS_VERSION + "." + id;

export const clamp = (col, width) => Math.max(col.min || 40, Math.min(col.max || 2000, Math.round(width)));

// ---- what is remembered per table: widths, hidden columns, sort. Anything unreadable gives the defaults.
export function loadPrefs(storage, id, defaults = {}) {
  const empty = { widths: {}, hidden: [...(defaults.hidden || [])], sort: null, order: [], opts: {} };
  try {
    const raw = JSON.parse(storage.getItem(prefsKey(id)));
    if (!raw || typeof raw !== "object" || raw.v !== PREFS_VERSION) return empty;
    const widths = {};
    for (const [key, value] of Object.entries(raw.widths && typeof raw.widths === "object" ? raw.widths : {})) if (Number.isFinite(value) && value > 0) widths[key] = value;
    const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(k => typeof k === "string") : [];
    const sort = raw.sort && typeof raw.sort.key === "string" && ["asc", "desc"].includes(raw.sort.dir) ? { key: raw.sort.key, dir: raw.sort.dir } : null;
    const order = Array.isArray(raw.order) ? raw.order.filter(k => typeof k === "string") : [];
    const opts = {};
    for (const [key, value] of Object.entries(raw.opts && typeof raw.opts === "object" && !Array.isArray(raw.opts) ? raw.opts : {})) if (["string", "number", "boolean"].includes(typeof value)) opts[key] = value;
    return { widths, hidden, sort, order, opts };
  } catch (e) { return empty; }
}

export function savePrefs(storage, id, prefs) {
  try { storage.setItem(prefsKey(id), JSON.stringify({ v: PREFS_VERSION, widths: prefs.widths, hidden: prefs.hidden, sort: prefs.sort, order: prefs.order || [], opts: prefs.opts || {} })); } catch (e) { /* not remembered */ }
}

export function clearPrefs(storage, id) {
  try { storage.removeItem(prefsKey(id)); } catch (e) { /* nothing to forget */ }
}

// ---- widths
export function startWidths(columns, saved) {
  const out = {};
  for (const col of columns) out[col.key] = clamp(col, saved && saved[col.key] ? saved[col.key] : col.width || col.min || 80);
  return out;
}

// The columns that fit in `room` pixels: the ones the user hid are out, then the least important until the minimums fit.
// A required column (by default the first) is never dropped.
export function visibleColumns(columns, hidden, room) {
  const required = columns.some(c => c.required) ? c => !!c.required : c => c === columns[0];
  let shown = columns.filter(c => !hidden.includes(c.key) || required(c));
  const need = list => list.reduce((sum, c) => sum + (c.min || 40), 0);
  for (let droppable = shown.filter(c => !required(c)); droppable.length && need(shown) > room; droppable = shown.filter(c => !required(c))) {
    const drop = droppable.reduce((low, c) => ((c.priority || 0) < (low.priority || 0) ? c : low));
    shown = shown.filter(c => c !== drop);
  }
  return shown;
}

// The pixel width of each shown column: the widths asked for, but the flex column (by default the last) takes what is left (at least its
// minimum). If everything asked for is more than the room, the other columns shrink from the end, down to their minimums.
export function layoutWidths(shown, widths, room) {
  const out = {};
  const grow = shown.find(c => c.flex) || shown[shown.length - 1];
  const others = shown.filter(c => c !== grow);
  others.forEach(c => { out[c.key] = clamp(c, widths[c.key] || c.width || c.min); });
  let used = others.reduce((sum, c) => sum + out[c.key], 0);
  let rest = room - used;
  if (rest < (grow.min || 40) && others.length) {
    let over = (grow.min || 40) - rest;
    for (const c of [...others].reverse()) {
      const give = Math.min(over, out[c.key] - (c.min || 40));
      out[c.key] -= give; over -= give;
      if (over <= 0) break;
    }
    used = others.reduce((sum, c) => sum + out[c.key], 0);
    rest = room - used;
  }
  out[grow.key] = Math.max(grow.min || 40, Math.min(grow.max || 5000, rest));
  return out;
}

// ---- order: the keys the user arranged first, then any column that is new in the default order
export function orderedColumns(columns, order) {
  const by = new Map(columns.map(c => [c.key, c]));
  const known = (order || []).filter((k, i, all) => by.has(k) && all.indexOf(k) === i);
  return [...known.map(k => by.get(k)), ...columns.filter(c => !known.includes(c.key))];
}
// Column `key` goes to position `to` (0 = first) among all the columns. Returns the new order of keys.
export function moveColumn(columns, order, key, to) {
  const keys = orderedColumns(columns, order).map(c => c.key);
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  keys.splice(from, 1);
  keys.splice(Math.max(0, Math.min(keys.length, to)), 0, key);
  return keys;
}
// Alt+Left / Alt+Right on a header: one step among the columns that are shown (hidden ones keep their place relative to the neighbour).
export function shiftColumn(columns, order, shownKeys, key, dir) {
  const all = orderedColumns(columns, order).map(c => c.key);
  const at = shownKeys.indexOf(key), other = shownKeys[at + dir];
  if (at < 0 || other === undefined) return all;
  return moveColumn(columns, order, key, all.indexOf(other));
}
// Where a dragged header lands: the index of the shown column under x (pixels from the left edge of the table), given their widths in order.
export function dropIndex(widths, x) {
  let edge = 0;
  for (let i = 0; i < widths.length; i++) { edge += widths[i]; if (x < edge - widths[i] / 2) return i; }
  return widths.length - 1;
}

// Drag or keyboard: column `key` gets `delta` more pixels. Returns the new widths asked for (only that column changes).
export function resizeBy(columns, widths, key, delta) {
  const col = columns.find(c => c.key === key);
  if (!col) return widths;
  return { ...widths, [key]: clamp(col, (widths[key] || col.width || col.min) + delta) };
}

// A key pressed on a focused handle → the new width, or null when the key means nothing here.
export function keyResize(col, width, key, shift) {
  const step = shift ? 40 : 10;
  if (key === "ArrowLeft") return clamp(col, width - step);
  if (key === "ArrowRight") return clamp(col, width + step);
  if (key === "Home") return clamp(col, col.min || 40);
  if (key === "End") return clamp(col, col.max || 2000);
  return null;
}

// The width that shows the widest content of a column; `measure(text)` gives pixels (a canvas in the page, a stub in tests).
export function fitWidth(col, texts, measure, padding = 24) {
  const widest = Math.max(measure(col.label || "") + 20, ...texts.map(t => measure(String(t == null ? "" : t))));
  return clamp(col, widest + padding);
}

// ---- sorting
export const STATUS_ORDER = "MARDCTU?";   // modified first, untracked last: what a reviewer looks at first

export function nextSort(current, key) {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

// A stable sort by an accessor; no sort returns the rows in their original order.
export function sortRows(rows, sort, accessors) {
  if (!sort || !accessors[sort.key]) return rows;
  const get = accessors[sort.key];
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows.map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      const x = a.value, y = b.value;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return c * sign || a.index - b.index;
    }).map(x => x.row);
}

export const statusRank = status => { const i = STATUS_ORDER.indexOf(status); return i < 0 ? STATUS_ORDER.length : i; };

// ---- long paths: keep the file name, shorten the folders in the middle
export function middleEllipsis(path, fits) {
  if (fits(path)) return path;
  const cut = path.lastIndexOf("/");
  const name = cut < 0 ? path : path.slice(cut + 1);
  const dir = cut < 0 ? "" : path.slice(0, cut + 1);
  if (!dir) { let n = name; while (n.length > 4 && !fits(n)) n = n.slice(0, Math.ceil(n.length * 0.45)) + "…" + n.slice(-Math.floor(n.length * 0.4)); return n; }
  for (let keep = dir.length - 1; keep >= 2; keep--) {
    const head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
    const candidate = dir.slice(0, head) + "…" + dir.slice(dir.length - tail) + name;
    if (fits(candidate)) return candidate;
  }
  return fits("…/" + name) ? "…/" + name : name;
}
