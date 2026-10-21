/* A draggable divider between two panes, with the keyboard, a double click to reset, and a remembered size. */
import { html, useState, useEffect, useRef, useCallback } from "../../vendor/preact-htm.js";
import { bounds, clearSize, dragSize, fitSize, keySize, loadSize, saveSize } from "../splitter.js";
import { cn } from "./ui.js";

// The size of an element, kept up to date.
export function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const watch = () => setSize({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    watch();
    const observer = new ResizeObserver(watch);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref.current]);
  return size;
}

// The size of one pane out of `total`: remembered under `id`, and kept inside the limits when the window changes.
export function useSplit(id, { initial, min, otherMin, total }) {
  const [chosen, setChosen] = useState(() => loadSize(localStorage, id, initial));
  const limits = bounds(total || 100000, min, otherMin);
  const size = total ? fitSize(chosen, total, min, otherMin) : chosen;
  const set = useCallback(value => { setChosen(value); saveSize(localStorage, id, value); }, [id]);
  const reset = useCallback(() => { setChosen(initial); clearSize(localStorage, id); }, [id, initial]);
  return { size, set, reset, min: limits.min, max: limits.max };
}

// axis: "x" for a handle between left and right panes, "y" for one between top and bottom panes.
// grow: +1 when moving right/down makes the pane before the handle bigger, -1 when it makes the one after it bigger.
export function Splitter({ split, axis = "x", grow = 1, label }) {
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: split.size, from: axis === "x" ? e.clientX : e.clientY };
    setDragging(true);
    document.body.classList.add("is-dragging", axis === "x" ? "drag-x" : "drag-y");
  };
  const onMove = e => {
    if (!drag.current) return;
    split.set(dragSize(drag.current.start, (axis === "x" ? e.clientX : e.clientY) - drag.current.from, grow, split.min, split.max));
  };
  const end = () => { drag.current = null; setDragging(false); document.body.classList.remove("is-dragging", "drag-x", "drag-y"); };
  const onKey = e => {
    const next = keySize(e.key, e.shiftKey, split.size, split.min, split.max, axis, grow);
    if (next !== null) { e.preventDefault(); e.stopPropagation(); split.set(next); }
  };
  return html`<div class=${cn("splitter", "splitter-" + axis, dragging && "is-active")} role="separator" aria-orientation=${axis === "x" ? "vertical" : "horizontal"} aria-label=${label}
    aria-valuenow=${split.size} aria-valuemin=${split.min} aria-valuemax=${split.max} tabIndex="0" title="Drag to resize, double click to reset"
    onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${end} onPointerCancel=${end} onLostPointerCapture=${end} onKeyDown=${onKey} onDblClick=${split.reset}></div>`;
}
