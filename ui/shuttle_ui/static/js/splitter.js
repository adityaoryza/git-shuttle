/* The arithmetic of a draggable divider: sizes, limits, the keyboard, what is remembered. Pure, tested with node.
 *
 * A splitter gives a pane `size` pixels out of `total`; the other pane keeps at least `otherMin`, so nothing becomes unusable.
 */

export const SPLIT_VERSION = 1;
const sizeKey = id => "shuttle.split." + SPLIT_VERSION + "." + id;

export const bounds = (total, min, otherMin) => ({ min, max: Math.max(min, total - otherMin) });

export function clampSize(size, min, max) {
  return Math.round(Math.max(min, Math.min(max, size)));
}

// The size to use after the window changed: what was chosen, as far as it still fits.
export function fitSize(size, total, min, otherMin) {
  const { max } = bounds(total, min, otherMin);
  return clampSize(size, min, max);
}

export function loadSize(storage, id, fallback) {
  try {
    const value = JSON.parse(storage.getItem(sizeKey(id)));
    return value && value.v === SPLIT_VERSION && Number.isFinite(value.size) && value.size > 0 ? value.size : fallback;
  } catch (e) { return fallback; }
}

export function saveSize(storage, id, size) {
  try { storage.setItem(sizeKey(id), JSON.stringify({ v: SPLIT_VERSION, size })); } catch (e) { /* not remembered */ }
}

export function clearSize(storage, id) {
  try { storage.removeItem(sizeKey(id)); } catch (e) { /* nothing to forget */ }
}

// A drag: the pointer moved by `delta` pixels along the axis. `grow` is +1 when moving right/down makes the pane bigger
// (the pane before the handle) and -1 when it makes it smaller (the pane after the handle).
export function dragSize(start, delta, grow, min, max) {
  return clampSize(start + grow * delta, min, max);
}

// The keyboard on a focused handle. `axis` is where the handle lets the pane grow: "x" (Left/Right) or "y" (Up/Down).
// `grow` is the same sign as for a drag. Home and End give the controlled pane its smallest or biggest size; any other key returns null.
export function keySize(key, shift, size, min, max, axis, grow) {
  const step = shift ? 80 : 20;
  const more = axis === "x" ? "ArrowRight" : "ArrowDown", less = axis === "x" ? "ArrowLeft" : "ArrowUp";
  if (key === more) return clampSize(size + grow * step, min, max);
  if (key === less) return clampSize(size - grow * step, min, max);
  if (key === "Home") return min;      // the size of the pane the handle controls: aria-valuemin / aria-valuemax
  if (key === "End") return max;
  return null;
}
