/* Ctrl+K: every action of the page by name, with the command line it stands for. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { filterActions } from "../ops.js";
import { SearchIcon } from "./ui.js";

export function Palette({ entries, onPick, onClose, early, onReady }) {
  const [query, setQuery] = useState(early ? early.current.text : "");
  useEffect(() => {          // keys typed between Ctrl+K and now were kept: the text, and an Enter
    if (early) { setQuery(early.current.text); if (early.current.enter) { const first = filterActions(entries, early.current.text)[0]; if (first && !first.reason) { onClose(); onPick(first); } } }
    if (onReady) onReady();
  }, []);
  const [at, setAt] = useState(0);
  const list = useRef(null), input = useRef(null);
  // the search gets the focus when the palette appears: at once if the element is in the page, else right after it is
  const focusNow = el => { input.current = el; if (el && document.activeElement !== el) el.focus(); };
  useEffect(() => { const el = input.current; if (el && document.activeElement !== el) el.focus(); const id = setTimeout(() => { if (input.current && document.activeElement !== input.current) input.current.focus(); }, 30); return () => clearTimeout(id); }, []);
  const found = filterActions(entries, query);
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => {          // Escape closes it wherever the focus is
    const esc = e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  useEffect(() => { const el = list.current && list.current.querySelector(".on"); if (el) el.scrollIntoView({ block: "nearest" }); }, [at]);
  const choose = e => { if (e && !e.reason) { onClose(); onPick(e); } };
  const key = ev => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setAt(Math.min(found.length - 1, at + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAt(Math.max(0, at - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); choose(found[at]); }
    else if (ev.key === "Escape") { ev.preventDefault(); onClose(); }
    else if (ev.key === "Tab") { ev.preventDefault(); }       // the focus stays in the palette
  };
  return html`<div class="overlay overlay-top" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="palette" role="dialog" aria-label="Actions" onKeyDown=${key}>
      <div class="palette-head"><${SearchIcon} /><input class="input palette-input" ref=${focusNow} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant=${found[at] ? "pal-" + at : undefined} placeholder="Type an action: push, rename a branch, stash…" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
      <ul id="palette-list" role="listbox" ref=${list}>
        ${found.length === 0 ? html`<li class="palette-empty">No action matches “${query}”.</li>` : found.map((e, i) => html`<li id=${"pal-" + i} role="option" aria-selected=${i === at} aria-disabled=${!!e.reason} class=${(i === at ? "on " : "") + (e.reason ? "off" : "")} onMouseMove=${() => setAt(i)} onClick=${() => choose(e)}>
          <span class="pal-main"><span class="pal-label">${e.label}</span><span class="pal-group">${e.group}</span>${e.key ? html`<kbd>${e.key}</kbd>` : null}</span>
          ${e.reason ? html`<span class="pal-reason">${e.reason}</span>` : e.cli ? html`<code class="pal-cli">${e.cli}</code>` : null}</li>`)}
      </ul>
      <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run (after a preview)</span><span><kbd>Esc</kbd> close</span></div>
    </div></div>`;
}
