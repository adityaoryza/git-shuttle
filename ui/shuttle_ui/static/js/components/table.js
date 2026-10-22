/* A table with columns you can resize, sort, hide and remember: used for the files of a commit and of the working tree.
 * The arithmetic is in js/columns.js (tested); this file is the DOM: pointer and keyboard handling, selection, the menu. */
import { html, useState, useEffect, useRef, useMemo } from "../../vendor/preact-htm.js";
import { clamp, clearPrefs, dropIndex, fitWidth, keyResize, layoutWidths, loadPrefs, moveColumn, nextSort, orderedColumns, resizeBy, savePrefs, shiftColumn, sortRows, startWidths, visibleColumns } from "../columns.js";
import { cn } from "./ui.js";
import { useSize } from "./splitter.js";

// the room at the right of the header that the gear of the column menu has for itself
const GUTTER = 32;

let canvas;
function textWidth(text, font) {
  canvas = canvas || document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(text).width;
}

// The rows of a selection from `anchor` to `index` (Shift+click or Shift+arrows).
const range = (keys, a, b) => keys.slice(Math.min(a, b), Math.max(a, b) + 1);

// reorderable: headers can be dragged (or moved with Alt+Left/Right). rowClass/rowAttrs: extra class and attributes of a row.
// menuExtras({ opts, setOpt }): more choices in the column menu, remembered with the rest. `col.fit(rows)` gives the width that fits a column.
export function ResizableTable({ id, label, columns: defaultColumns, sections, tree, rowKey, selected, onSelect, activeKey, onOpen, onSpace, onRowMenu, accessors, footer, empty, tools, reorderable, rowClass, rowAttrs, menuExtras, tail, onRowClick, class: klass }) {
  const root = useRef(null);
  const { width: room } = useSize(root);
  const defaults = useMemo(() => ({ hidden: defaultColumns.filter(c => c.hiddenByDefault).map(c => c.key) }), [defaultColumns]);
  const [prefs, setPrefs] = useState(() => loadPrefs(localStorage, id, defaults));
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(null);       // a header being dragged: { key, to }
  const anchor = useRef(null);
  const press = useRef(null);
  const justMoved = useRef(false);
  const drag = useRef(null);
  const update = next => { setPrefs(next); savePrefs(localStorage, id, next); };

  const columns = useMemo(() => orderedColumns(defaultColumns, prefs.order), [defaultColumns, prefs.order]);
  const shown = useMemo(() => visibleColumns(columns, prefs.hidden, (room || 100000) - GUTTER), [columns, prefs.hidden, room]);
  const wanted = useMemo(() => startWidths(columns, prefs.widths), [columns, prefs.widths]);
  const widths = useMemo(() => layoutWidths(shown, wanted, (room || 100000) - GUTTER), [shown, wanted, room]);
  const template = shown.map(c => widths[c.key] + "px").join(" ");

  // the rows in order: each section sorted by itself (a tree keeps its own order)
  const ordered = useMemo(() => sections.map(s => ({ ...s, rows: tree ? s.rows : sortRows(s.rows, prefs.sort, accessors || {}) })), [sections, tree, prefs.sort, accessors]);
  const flat = useMemo(() => ordered.flatMap(s => s.rows), [ordered]);
  const selectable = flat.filter(r => !r.dir && !r.full);
  const keys = selectable.map(rowKey);

  // ---- selection: click, Ctrl/Cmd+click, Shift+click, arrows, Ctrl+A
  const choose = (row, e) => {
    const key = rowKey(row);
    if (e.shiftKey && anchor.current !== null && keys.includes(anchor.current)) onSelect(new Set(range(keys, keys.indexOf(anchor.current), keys.indexOf(key))), key);
    else if (e.ctrlKey || e.metaKey) { const next = new Set(selected); next.has(key) ? next.delete(key) : next.add(key); anchor.current = key; onSelect(next, key); }
    else { anchor.current = key; onSelect(new Set([key]), key); }
  };
  const move = (delta, extend) => {
    if (!keys.length) return;
    const at = activeKey === undefined || activeKey === null ? -1 : keys.indexOf(activeKey);
    const to = Math.max(0, Math.min(keys.length - 1, at < 0 ? 0 : at + delta));
    if (extend) { if (anchor.current === null) anchor.current = keys[Math.max(at, 0)]; onSelect(new Set(range(keys, keys.indexOf(anchor.current), to)), keys[to]); }
    else { anchor.current = keys[to]; onSelect(new Set([keys[to]]), keys[to]); }
    const el = root.current && root.current.querySelector('[data-key="' + CSS.escape(keys[to]) + '"]');
    if (el) el.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = e => {
    if (e.target.closest("input, select, textarea, .col-handle, .table-menu")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1, e.shiftKey); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, e.shiftKey); }
    else if (e.key === "Home") { e.preventDefault(); move(-1e9, e.shiftKey); }
    else if (e.key === "End") { e.preventDefault(); move(1e9, e.shiftKey); }
    else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSelect(new Set(keys), activeKey); }
    else if (e.key === " " && onSpace) { e.preventDefault(); onSpace(selectable.filter(r => selected.has(rowKey(r)))); }
    else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && onRowMenu) {
      const row = selectable.find(r => rowKey(r) === activeKey), el = root.current.querySelector('[data-key="' + CSS.escape(String(activeKey)) + '"]');
      if (row && el) { e.preventDefault(); const box = el.getBoundingClientRect(); onRowMenu(box.left + 60, box.bottom, row, selectable.filter(r => selected.has(rowKey(r)))); }
    }
    else if (e.key === "Enter" && onOpen) { const row = selectable.find(r => rowKey(r) === activeKey); if (row) { e.preventDefault(); onOpen(row); } }
  };

  // ---- resizing: pointer drag, keyboard, double click to fit
  const startDrag = (e, col) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key: col.key, from: e.clientX, start: widths[col.key] };
    document.body.classList.add("is-dragging", "drag-x");
  };
  const moveDrag = e => {
    if (!drag.current) return;
    const { key, from, start } = drag.current;
    update({ ...prefs, widths: resizeBy(columns, { ...wanted, [key]: start }, key, e.clientX - from) });
  };
  const endDrag = () => { drag.current = null; document.body.classList.remove("is-dragging", "drag-x"); };
  const fit = col => {
    if (col.fit) { update({ ...prefs, widths: { ...wanted, [col.key]: clamp(col, col.fit(flat)) } }); return; }
    const probe = root.current.querySelector(".trow .tcell");
    const font = probe ? getComputedStyle(probe).font : "13px sans-serif";
    const texts = flat.filter(r => !r.dir && !r.full).map(r => (col.text ? col.text(r) : ""));
    update({ ...prefs, widths: { ...wanted, [col.key]: fitWidth(col, texts, t => textWidth(t, font)) } });
  };
  const handleKey = (e, col) => {
    const next = keyResize(col, widths[col.key], e.key, e.shiftKey);
    if (next !== null) { e.preventDefault(); e.stopPropagation(); update({ ...prefs, widths: { ...wanted, [col.key]: next } }); }
  };
  const toggleSort = col => update({ ...prefs, sort: nextSort(prefs.sort, col.key) });
  const toggleColumn = key => update({ ...prefs, hidden: prefs.hidden.includes(key) ? prefs.hidden.filter(k => k !== key) : [...prefs.hidden, key] });
  const reset = () => { clearPrefs(localStorage, id); setPrefs({ widths: {}, hidden: defaults.hidden, sort: null, order: [], opts: {} }); setMenu(false); };
  const setOpt = (key, value) => update({ ...prefs, opts: { ...prefs.opts, [key]: value } });

  // ---- moving a column: drag its header, or Alt+Left / Alt+Right on it
  const required = c => (defaultColumns.some(x => x.required) ? !!c.required : c === defaultColumns[0]);
  const edges = () => shown.map(c => widths[c.key]);
  const pressHeader = (e, col) => {
    if (!reorderable || (e.button !== undefined && e.button !== 0) || e.target.closest(".col-handle")) return;
    press.current = { key: col.key, x: e.clientX, active: false };
  };
  const dragHeader = e => {
    const p = press.current;
    if (!p) return;
    if (!p.active && Math.abs(e.clientX - p.x) < 6) return;
    if (!p.active) { p.active = true; e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add("is-dragging", "drag-x"); }
    const left = root.current.getBoundingClientRect().left;
    setMoving({ key: p.key, to: dropIndex(edges(), e.clientX - left) });
  };
  const dropHeader = () => {
    const p = press.current;
    press.current = null;
    document.body.classList.remove("is-dragging", "drag-x");
    if (!p || !p.active) { setMoving(null); return; }
    justMoved.current = true; setTimeout(() => { justMoved.current = false; }, 0);
    const target = moving ? shown[moving.to] : null;
    setMoving(null);
    if (target && target.key !== p.key) update({ ...prefs, order: moveColumn(columns, prefs.order, p.key, columns.indexOf(target)) });
  };
  const headerKeys = (e, col) => {
    if (!reorderable || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); e.stopPropagation();
    const order = shiftColumn(columns, prefs.order, shown.map(c => c.key), col.key, e.key === "ArrowLeft" ? -1 : 1);
    update({ ...prefs, order });
    setTimeout(() => { const el = root.current && root.current.querySelector('[data-col="' + col.key + '"] .thsort, [data-col="' + col.key + '"] .thlabel'); if (el) el.focus(); }, 60);
  };

  useEffect(() => {
    if (!menu) return undefined;
    const away = e => { if (!e.target.closest(".table-menu, .table-gear")) setMenu(false); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [menu]);

  const ariaSort = col => (prefs.sort && prefs.sort.key === col.key ? (prefs.sort.dir === "asc" ? "ascending" : "descending") : "none");
  const empty_ = !flat.length;

  return html`<div class=${cn("table", klass)} ref=${root} onKeyDown=${onKeyDown}>
    <div class="trow thead" role="row" style=${{ gridTemplateColumns: template + " " + GUTTER + "px" }}>
      ${shown.map((col, i) => html`<div key=${col.key} class=${cn("tcell", "thcell", col.align && "t-" + col.align, moving && moving.key === col.key && "is-moving")} role="columnheader" data-col=${col.key} aria-sort=${col.sortable === false ? undefined : ariaSort(col)}
        onPointerDown=${e => pressHeader(e, col)} onPointerMove=${dragHeader} onPointerUp=${dropHeader} onPointerCancel=${dropHeader} onKeyDown=${e => headerKeys(e, col)}>
        ${col.sortable === false ? html`<span class="thlabel" tabIndex=${reorderable ? 0 : undefined} title=${reorderable ? "Drag to move, or Alt+Left and Alt+Right" : undefined}>${col.label}</span>`
          : html`<button type="button" class="thsort" onClick=${() => { if (!justMoved.current) toggleSort(col); }} title=${"Sort by " + col.label + (reorderable ? " (drag to move)" : "")}>${col.label}<span class="sortmark" aria-hidden="true">${prefs.sort && prefs.sort.key === col.key ? (prefs.sort.dir === "asc" ? "▲" : "▼") : ""}</span></button>`}
        ${i < shown.length - 1 ? html`<span class="col-handle" role="separator" aria-orientation="vertical" aria-label=${"Resize the " + col.label + " column"} aria-valuenow=${widths[col.key]} aria-valuemin=${col.min || 40} aria-valuemax=${col.max || 2000} tabIndex="0"
          onPointerDown=${e => startDrag(e, col)} onPointerMove=${moveDrag} onPointerUp=${endDrag} onPointerCancel=${endDrag} onKeyDown=${e => handleKey(e, col)} onDblClick=${() => fit(col)} title="Drag to resize, double click to fit the content"></span>` : null}
      </div>`)}
      ${moving ? html`<span class="col-drop" aria-hidden="true" style=${{ left: shown.slice(0, moving.to).reduce((sum, c) => sum + widths[c.key], 0) + "px" }}></span>` : null}
      <span class="table-gutter"><button type="button" class="table-gear" aria-label="Columns" aria-expanded=${menu} title="Columns" onClick=${() => setMenu(!menu)}>⚙</button></span>
    </div>
    ${menu ? html`<div class="table-menu" role="dialog" aria-label="Columns">
      ${defaultColumns.map(col => html`<label class="check"><input type="checkbox" checked=${!prefs.hidden.includes(col.key) || required(col)} disabled=${required(col)} onChange=${() => toggleColumn(col.key)} /> ${col.label}${required(col) ? html` <span class="hint">(always shown)</span>` : null}</label>`)}
      ${menuExtras ? menuExtras({ opts: prefs.opts, setOpt }) : null}
      <button type="button" class="link" onClick=${reset}>Reset columns</button>
    </div>` : null}
    ${typeof tools === "function" ? tools({ sort: prefs.sort, clearSort: () => update({ ...prefs, sort: null }) }) : tools}
    <div class="tbody" role="grid" aria-label=${label} aria-multiselectable="true" tabIndex="0">
      ${empty_ ? html`<div class="tempty">${empty}</div>` : null}
      ${ordered.map(section => html`
        ${section.label ? html`<div class="tgroup" role="row"><span role="rowheader">${section.label}</span> <span class="count">${section.rows.length}</span></div>` : null}
        ${section.rows.map(row => row.full
          ? html`<div class="trow tfull" key=${row.key} role="row"><div class="tcell" role="gridcell" style=${{ gridColumn: "1 / -1" }}>${row.full()}</div></div>`
          : row.dir
          ? html`<div class="trow tdir" role="row" style=${{ gridTemplateColumns: template }} onClick=${() => section.onToggleDir && section.onToggleDir(row)}><div class="tcell" style=${{ paddingLeft: 8 + (row.depth || 0) * 14 + "px", gridColumn: "1 / -1" }}><span class="caret">${row.closed ? "▸" : "▾"}</span> <span class="mono">${row.name}/</span></div></div>`
          : html`<div class=${cn("trow", selected.has(rowKey(row)) && "is-selected", activeKey === rowKey(row) && "is-active", rowClass && rowClass(row))} role="row" aria-selected=${selected.has(rowKey(row))} data-key=${rowKey(row)} ...${rowAttrs ? rowAttrs(row) : {}} style=${{ gridTemplateColumns: template }}
              onClick=${e => { choose(row, e); if (onRowClick) onRowClick(row, e); }} onDblClick=${() => onOpen && onOpen(row)} onContextMenu=${e => { e.preventDefault(); if (!selected.has(rowKey(row))) { anchor.current = rowKey(row); onSelect(new Set([rowKey(row)]), rowKey(row)); } if (onRowMenu) onRowMenu(e.clientX, e.clientY, row, selected.has(rowKey(row)) ? selectable.filter(r => selected.has(rowKey(r))) : [row]); }}>
              ${shown.map(col => html`<div key=${col.key} class=${cn("tcell", col.align && "t-" + col.align)} role="gridcell">${col.render(row, { width: widths[col.key], opts: prefs.opts, sort: prefs.sort })}</div>`)}
            </div>`)}`)}
      ${tail}
    </div>
    ${footer ? html`<div class="tfoot">${footer}</div>` : null}
  </div>`;
}
