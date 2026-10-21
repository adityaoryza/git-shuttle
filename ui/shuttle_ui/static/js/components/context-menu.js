/* The right-click menu of a commit, and the two small dialogs its actions open. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { shortHash } from "../logic.js";
import { Alert, Button, Field, Input, Modal, Output } from "./ui.js";

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
  const [push, setPush] = useState(() => { try { return localStorage.getItem("shuttle.pushNewBranch") === "1"; } catch (e) { return false; } });
  const choosePush = value => { setPush(value); try { localStorage.setItem("shuttle.pushNewBranch", value ? "1" : "0"); } catch (e) { /* not remembered */ } };
  const go = () => name.trim() && onSubmit(name.trim(), push);
  return html`<${Modal} title="Create a branch here" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!name.trim()} onClick=${go}>Continue<//>`}>
    <p class="hint">At <code>${shortHash(commit.sha)}</code> ${commit.subject}</p>
    <${Field} label="Branch name"><${Input} class="mono" autofocus value=${name} placeholder="feature/my_task" onInput=${e => setName(e.target.value)} onKeyDown=${e => e.key === "Enter" && go()} /><//>
    <label class="check"><input type="checkbox" checked=${push} onChange=${e => choosePush(e.target.checked)} /> Push to the remote and set the upstream</label>
  <//>`;
}

/* A branch that has diverged from its upstream (usually after a rebase): a plain push would be rejected. Forcing it is a separate, explicit choice. */
export function DivergedDialog({ state, runner, onClose }) {
  const ready = runner.fresh("push", { force: true });
  const shown = runner.shown && runner.shown.key === JSON.stringify(["push", { force: true }]) ? runner.shown : null;
  return html`<${Modal} title=${"Force push " + state.branch + "?"} wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//>
      <${Button} variant="destructive" disabled=${!ready || runner.busy} onClick=${() => { onClose(); runner.run("push", { force: true }, "Force push " + state.branch); }}>Force push (with lease)<//>`}>
    <${Alert} tone="warn" title=${state.branch + " and " + state.upstream + " have diverged (↑" + state.ahead + " ↓" + state.behind + ")"}>
      <span>A normal push would be rejected. A force push with lease replaces the ${state.behind === 1 ? "1 commit" : state.behind + " commits"} on ${state.upstream} with yours, and still stops if somebody pushed since your last fetch. Anybody who already pulled those commits will have to reset.</span><//>
    ${!shown ? html`<p class="hint">Checking what it would do…</p>` : html`<p class="hint">${shown.ok ? "Exactly what will run:" : "Refused, nothing was changed:"}</p><${Output}>${shown.steps.map(s => s.output).join("\n")}<//>`}
  <//>`;
}

/* Shows what an action will do (a dry run), then runs it on request. */
export function ActionConfirm({ pending, runner, onClose }) {
  const ready = runner.fresh(pending.action, pending.params);
  const p = runner.shown && runner.shown.key === JSON.stringify([pending.action, pending.params]) ? runner.shown : null;
  return html`<${Modal} title=${pending.label} wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//>
      <${Button} variant=${pending.tone === "destructive" ? "destructive" : "default"} disabled=${!ready || runner.busy} onClick=${() => { onClose(); runner.run(pending.action, pending.params, pending.label); }}>${pending.verb || "Run"}<//>`}>
    ${!p ? html`<p class="hint">Checking what it would do…</p>` : html`<p class="hint">${p.ok ? "Exactly what will run:" : "Refused, nothing was changed:"}</p><${Output}>${p.steps.map(s => s.output).join("\n")}<//>`}
  <//>`;
}
