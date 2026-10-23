/* Small building blocks in the shadcn/ui style: plain elements and classes, no framework on top of Preact. */
import { html, useEffect, useRef } from "../../vendor/preact-htm.js";

export const cn = (...parts) => parts.filter(Boolean).join(" ");

// `busy` shows a spinner and blocks a second click while the action runs.
export function Button({ variant = "default", size = "md", class: klass, busy, children, disabled, ...props }) {
  return html`<button type="button" class=${cn("btn", "btn-" + variant, "btn-" + size, busy && "is-busy", klass)} aria-busy=${busy ? "true" : undefined} disabled=${disabled || busy} ...${props}>${busy ? html`<span class="spinner" aria-hidden="true"></span>` : null}${children}</button>`;
}

export function Spinner() {
  return html`<span class="spinner" role="status" aria-label="Loading"></span>`;
}

// A grey block in the shape of what is loading: it says "something is coming" without text that has to be replaced.
export function Skeleton({ rows = 6, height = 30 }) {
  return html`<div class="skeleton" aria-hidden="true">${Array.from({ length: rows }, (_, i) => html`<span class="skeleton-row" style=${{ height: height + "px", width: (92 - ((i * 13) % 40)) + "%" }}></span>`)}</div>`;
}

// A slim bar under the top bar while something runs.
export function ProgressBar({ active }) {
  return html`<div class=${cn("progress", active && "is-active")} role="progressbar" aria-busy=${active ? "true" : "false"} aria-label="Working"><span></span></div>`;
}

export function Badge({ tone = "neutral", children }) {
  return html`<span class=${"badge badge-" + tone}>${children}</span>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint ? html`<span class="field-hint">${hint}</span>` : null}</label>`;
}

// `inputRef`: a ref of the <input> (a plain `ref` does not reach a function component).
export function Input({ class: klass, inputRef, ...props }) {
  return html`<input class=${cn("input", klass)} spellcheck="false" ref=${inputRef} ...${props} />`;
}

export const SearchIcon = () => html`<svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>`;

// A search field: a leading icon and a clear button, in the box of the other controls. `class` is for the input, `wrapClass` for the box.
// onInput gets what an input event would give (e.target.value), also from the clear button.
export function Search({ class: klass, wrapClass, inputRef, value, onInput, ...props }) {
  const own = useRef(null);
  const clear = () => { onInput({ target: { value: "" } }); if (own.current) own.current.focus(); };
  return html`<span class=${cn("search", wrapClass)}>
    <${SearchIcon} />
    <input class=${cn("input", "search-input", klass)} type="search" spellcheck="false" autocomplete="off" ref=${el => { own.current = el; if (inputRef) inputRef.current = el; }} value=${value} onInput=${onInput} ...${props} />
    ${value ? html`<button type="button" class="search-clear" aria-label="Clear the search" title="Clear" tabindex="-1" onMouseDown=${e => e.preventDefault()} onClick=${clear}>✕</button>` : null}
  </span>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="tablist">${options.map(o => html`
    <button type="button" role="tab" aria-selected=${o.value === value} class=${o.value === value ? "on" : ""} onClick=${() => onChange(o.value)}>${o.label}</button>`)}</div>`;
}

export function Alert({ tone = "neutral", title, children }) {
  return html`<div class=${"alert alert-" + tone}>${title ? html`<strong>${title}</strong>` : null}${children}</div>`;
}

// follow: a command that is still running; the view stays at the last line, unless the reader scrolled up to read
export function Output({ children, follow }) {
  const ref = useRef(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (follow && el && atEnd.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = e => { atEnd.current = e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < 24; };
  return html`<pre class="output" ref=${ref} onScroll=${onScroll}>${children}</pre>`;
}

export function Modal({ title, onClose, children, footer, wide, className, initialFocus }) {
  const ref = useRef(null);
  // the first field gets the focus as soon as the dialog is in the page (the autofocus attribute does not work on what is added later)
  const focusFirst = el => {
    if (el && el.isConnected && !el.contains(document.activeElement)) { const first = el.querySelector(initialFocus || "[autofocus], input:not([type=checkbox]):not([type=radio]), textarea, select"); if (first) first.focus(); }
  };
  const place = el => { ref.current = el; focusFirst(el); };
  useEffect(() => {
    focusFirst(ref.current);   // the element may not have been in the page yet when the ref was set
    const key = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return html`<div class="overlay" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${cn("modal", wide && "modal-wide", className)} role="dialog" aria-label=${title} ref=${place}>
      <div class="modal-head"><h2>${title}</h2><${Button} variant="ghost" size="icon" onClick=${onClose} aria-label="Close">✕<//></div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : null}
    </div></div>`;
}
