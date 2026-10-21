/* The right-click menu of a commit, and the two small dialogs its actions open. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { shortHash } from "../logic.js";
import { Button, Field, Input, Modal, Output } from "./ui.js";

export function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useEffect(() => {
    // keep the menu inside the window
    const box = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(menu.x, innerWidth - box.width - 8)), top: Math.max(8, Math.min(menu.y, innerHeight - box.height - 8)) });
    const away = e => { if (!ref.current.contains(e.target)) onClose(); };
    const key = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    window.addEventListener("blur", onClose); window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    ref.current.querySelector("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, []);
  return html`<div class="ctx" role="menu" ref=${ref} style=${{ left: pos.left + "px", top: pos.top + "px" }}>
    <div class="ctx-title">${menu.title}</div>
    ${menu.items.map(it => it === "-" ? html`<hr />` : html`<button type="button" role="menuitem" disabled=${!!it.disabled} title=${it.disabled || ""} onClick=${() => { onClose(); it.run(); }}>
      <span>${it.label}</span>${it.disabled ? html`<span class="hint">${it.disabled}</span>` : null}</button>`)}
  </div>`;
}

/* A name for a new branch at a commit. */
export function BranchHereDialog({ commit, onSubmit, onClose }) {
  const [name, setName] = useState("");
  const go = () => name.trim() && onSubmit(name.trim());
  return html`<${Modal} title="Create a branch here" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!name.trim()} onClick=${go}>Continue<//>`}>
    <p class="hint">At <code>${shortHash(commit.sha)}</code> ${commit.subject}</p>
    <${Field} label="Branch name"><${Input} class="mono" autofocus value=${name} placeholder="feature/my_task" onInput=${e => setName(e.target.value)} onKeyDown=${e => e.key === "Enter" && go()} /><//>
  <//>`;
}

/* Shows what an action will do (a dry run), then runs it on request. */
export function ActionConfirm({ pending, runner, onClose }) {
  const ready = runner.fresh(pending.action, pending.params);
  const p = runner.shown && runner.shown.key === JSON.stringify([pending.action, pending.params]) ? runner.shown : null;
  return html`<${Modal} title=${pending.label} wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//>
      <${Button} disabled=${!ready || runner.busy} onClick=${() => { onClose(); runner.run(pending.action, pending.params, pending.label); }}>${pending.verb || "Run"}<//>`}>
    ${!p ? html`<p class="hint">Checking what it would do…</p>` : html`<p class="hint">${p.ok ? "Exactly what will run:" : "Refused, nothing was changed:"}</p><${Output}>${p.steps.map(s => s.output).join("\n")}<//>`}
  <//>`;
}
