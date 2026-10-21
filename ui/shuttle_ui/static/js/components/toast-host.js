/* The notifications: a stack in a corner, each with an icon, a title, an optional detail and buttons. */
import { html, useState, useRef, useEffect } from "../../vendor/preact-htm.js";
import { createToasts } from "../toasts.js";
import { cn } from "./ui.js";

const Svg = ({ children }) => html`<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
const ICONS = {
  success: html`<${Svg}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /><//>`,
  info: html`<${Svg}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /><//>`,
  warning: html`<${Svg}><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5h.01" /><//>`,
  error: html`<${Svg}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /><//>`,
};

// One queue for the whole page: `push` shows a toast, the rest is what the host needs.
export function useToasts() {
  const [items, setItems] = useState([]);
  const queue = useRef(null);
  if (!queue.current) queue.current = createToasts({ onChange: setItems });
  useEffect(() => () => queue.current.clear(), []);
  return [items, queue.current];
}

function copyText(text) {
  try { return navigator.clipboard.writeText(text); } catch (e) { return Promise.reject(e); }
}

function Toast({ item, queue }) {
  const [copied, setCopied] = useState(false);
  const isError = item.variant === "error";
  const copy = text => copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  const run = action => { if (action.copy) copy(action.copy); if (action.onClick) action.onClick(); if (action.dismiss !== false && !action.copy) queue.dismiss(item.id); };
  return html`<div class=${cn("toast", "toast-" + item.variant, item.leaving && "is-leaving", item.paused && "is-paused")} role=${isError ? "alert" : "status"}
      onMouseEnter=${() => queue.pause(item.id)} onMouseLeave=${() => queue.resume(item.id)}
      onFocusIn=${() => queue.pause(item.id)} onFocusOut=${() => queue.resume(item.id)}
      onKeyDown=${e => { if (e.key === "Escape") { e.stopPropagation(); queue.dismiss(item.id); } }} tabIndex="-1">
    <span class="toast-icon">${ICONS[item.variant]}</span>
    <div class="toast-body">
      <div class="toast-title">${item.title}${item.count > 1 ? html`<span class="toast-count" aria-label=${item.count + " times"}>×${item.count}</span>` : null}</div>
      ${item.detail ? (isError ? html`<pre class="toast-detail toast-detail-full">${item.detail}</pre>` : html`<div class="toast-detail">${item.detail}</div>`) : null}
      ${item.actions.length || isError ? html`<div class="toast-actions">
        ${item.actions.map(action => html`<button type="button" class="toast-action" onClick=${() => run(action)}>${action.copy && copied ? "Copied" : action.label}</button>`)}
        ${isError && item.detail ? html`<button type="button" class="toast-action" onClick=${() => copy(item.detail)}>${copied ? "Copied" : "Copy details"}</button>` : null}
      </div>` : null}
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss" onClick=${() => queue.dismiss(item.id)}>
      <${Svg}><path d="M6 6l12 12M18 6L6 18" /><//>
    </button>
    ${item.duration ? html`<span class="toast-bar" key=${item.id + ":" + item.count} style=${{ "--toast-ms": item.duration + "ms" }} aria-hidden="true"></span>` : null}
  </div>`;
}

export function ToastHost({ items, queue }) {
  return html`<div class="toasts" aria-live="polite" aria-relevant="additions text">${items.map(item => html`<${Toast} item=${item} queue=${queue} key=${item.id} />`)}</div>`;
}
