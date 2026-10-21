/* A confirmation in a dialog, for the things that cannot be undone (the browser's own confirm() is not styled and cannot be tested). */
import { html } from "../../vendor/preact-htm.js";
import { Button, Modal } from "./ui.js";

// request: { title, body, confirmLabel, tone: "destructive" | "default", resolve }
export function ConfirmDialog({ request, onAnswer }) {
  const answer = yes => onAnswer(yes);
  return html`<${Modal} title=${request.title} onClose=${() => answer(false)} footer=${html`
      <${Button} variant="ghost" onClick=${() => answer(false)}>Cancel<//>
      <${Button} variant=${request.tone === "destructive" ? "destructive" : "default"} autofocus onClick=${() => answer(true)}>${request.confirmLabel || "Confirm"}<//>`}>
    ${request.body ? html`<p class="lead prewrap">${request.body}</p>` : null}
  <//>`;
}
