/* A text field that lists what exists while you type, so the value is picked, not guessed. */
import { html, useState, useRef, useEffect } from "../../vendor/preact-htm.js";
import { matchOptions } from "../logic.js";
import { cn } from "./ui.js";

export function Combobox({ value, onChange, options, placeholder, label, exactOnly, scope }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const list = matchOptions(options, open ? value : "", 60);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => { setActive(0); }, [value, open]);

  const choose = o => { onChange(o.name); setOpen(false); };
  const key = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(Math.min(active + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); choose(list[active]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }   // closes the list, not the dialog
  };
  const hit = options.find(o => o.name === value);
  const exists = !!hit;
  const near = !exists && value ? matchOptions(options, value, 3) : [];
  const mark = value && hit && !open ? (hit.where || "") : "";

  return html`<div class=${cn("combo", mark && "has-state")} ref=${box}>
    <div class="combo-field">
      <input class=${cn("input", "mono", value && !exists && exactOnly && "invalid")} spellcheck="false" autocomplete="off" role="combobox" aria-expanded=${open} aria-label=${label}
        value=${value} placeholder=${placeholder} onInput=${e => { onChange(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)} onKeyDown=${key} />
      ${mark ? html`<span class="field-status combo-state">${mark}</span>` : null}
    </div>
    ${open && list.length ? html`<ul class="combo-list" role="listbox">${list.map((o, i) => html`
      <li role="option" aria-selected=${i === active} class=${cn(i === active && "on")} onMouseDown=${e => { e.preventDefault(); choose(o); }} onMouseEnter=${() => setActive(i)}>
        <span class="mono">${o.name}</span><span class="where">${o.where}</span></li>`)}</ul>` : null}
    ${value && !open && !exists && exactOnly ? html`<span class="field-hint warn">No branch named “${value}”${scope ? " " + scope : ""}.${near.length ? html` Did you mean <button type="button" class="link" onClick=${() => onChange(near[0].name)}>${near[0].name}</button>?` : ""}</span>` : null}
  </div>`;
}
