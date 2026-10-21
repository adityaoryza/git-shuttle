/* Small building blocks in the shadcn/ui style: plain elements and classes, no framework on top of Preact. */
import { html, useEffect, useRef } from "../../vendor/preact-htm.js";

export const cn = (...parts) => parts.filter(Boolean).join(" ");

export function Button({ variant = "default", size = "md", class: klass, ...props }) {
  return html`<button type="button" class=${cn("btn", "btn-" + variant, "btn-" + size, klass)} ...${props} />`;
}

export function Badge({ tone = "neutral", children }) {
  return html`<span class=${"badge badge-" + tone}>${children}</span>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint ? html`<span class="field-hint">${hint}</span>` : null}</label>`;
}

export function Input({ class: klass, ...props }) {
  return html`<input class=${cn("input", klass)} spellcheck="false" ...${props} />`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="tablist">${options.map(o => html`
    <button type="button" role="tab" aria-selected=${o.value === value} class=${o.value === value ? "on" : ""} onClick=${() => onChange(o.value)}>${o.label}</button>`)}</div>`;
}

export function Alert({ tone = "neutral", title, children }) {
  return html`<div class=${"alert alert-" + tone}>${title ? html`<strong>${title}</strong>` : null}${children}</div>`;
}

export function Output({ children }) {
  return html`<pre class="output">${children}</pre>`;
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const key = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return html`<div class="overlay" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${cn("modal", wide && "modal-wide")} role="dialog" aria-label=${title} ref=${ref}>
      <div class="modal-head"><h2>${title}</h2><${Button} variant="ghost" size="icon" onClick=${onClose} aria-label="Close">✕<//></div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : null}
    </div></div>`;
}

export function Toast({ toast }) {
  return toast ? html`<div class=${"toast toast-" + (toast.tone || "neutral")} role="status">${toast.text}</div>` : null;
}
