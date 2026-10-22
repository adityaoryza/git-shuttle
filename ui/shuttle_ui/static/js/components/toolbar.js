/* The toolbar under the top bar: the actions you reach for most, each with its shortcut and, when it is unavailable, the reason. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { reasonOf, labelOf, syncPlan } from "../ops.js";
import { pushTitle } from "../pushstate.js";
import { Button, Search, cn } from "./ui.js";

const KEYS = { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", push: "Shift+P", branch: "B", stash: "S", "stash-pop": "Shift+S", log: "L", fetch: "Shift+F" };

function Tool({ id, ctx, perform, label, glyph, variant = "ghost", class: klass, args, always }) {
  const reason = always ? "" : reasonOf(id, ctx, args);
  const text = labelOf(id, ctx, args, label || id);
  const tip = text + (KEYS[id] ? " (" + KEYS[id] + ")" : "") + (reason ? " — " + reason : "");
  return html`<${Button} variant=${variant} size="sm" class=${cn("tool", klass)} data-tool=${id} disabled=${!!reason} title=${tip} aria-label=${tip} onClick=${() => perform(id, args)}>${glyph ? html`<span class="glyph" aria-hidden="true">${glyph}</span>` : null}<span class="tool-label">${label || text}</span><//>`;
}

function PullMenu({ ctx, perform }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const integration = ctx.status && ctx.status["integration.ref"];
  const items = [["pull", "Pull (fast-forward only)"], ["pull-rebase", "Pull and rebase my commits"], ["pull-merge", "Pull and merge"], "-",
    ["sync", "Update from " + (integration || "the integration branch") + " (rebase)"], ["sync-merge", "Merge " + (integration || "the integration branch") + " into this branch"], "-", ["fetch", "Fetch (change nothing of mine)"]];
  return html`<div class="split-btn" ref=${box}>
    <${Tool} id="pull" ctx=${ctx} perform=${perform} label="Pull" glyph="↓" class="split-main" />
    <${Button} variant="ghost" size="sm" class="split-caret" aria-label="More ways to pull" aria-haspopup="menu" aria-expanded=${open} title="More ways to pull" onClick=${() => setOpen(!open)}>▾<//>
    ${open ? html`<div class="menu" role="menu">${items.map(it => it === "-" ? html`<hr />` : (() => {
      const reason = it[0] === "fetch" ? reasonOf("fetch", ctx) : reasonOf(it[0], ctx);
      return html`<button type="button" role="menuitem" disabled=${!!reason} title=${reason} onClick=${() => { setOpen(false); perform(it[0]); }}><span>${it[1]}</span>${reason ? html`<span class="hint">${reason}</span>` : null}</button>`;
    })())}</div>` : null}
  </div>`;
}

export function Toolbar({ ctx, perform, search, setSearch, searchRef, push }) {
  const plan = syncPlan(ctx);
  const planReason = reasonOf(plan.id, ctx);
  return html`<div class="toolbar" role="toolbar" aria-label="Actions">
    <${Tool} id="undo" ctx=${ctx} perform=${perform} label="Undo" glyph="↶" /><${Tool} id="redo" ctx=${ctx} perform=${perform} label="Redo" glyph="↷" />
    <span class="tool-sep" aria-hidden="true"></span>
    <${PullMenu} ctx=${ctx} perform=${perform} />
    ${push.kind !== "none" ? html`<${Button} variant=${push.kind === "diverged" ? "outline" : "secondary"} size="sm" class=${cn("tool", push.kind === "diverged" ? "push-diverged" : "push-btn")} data-tool="push" disabled=${push.disabled || ctx.busy} title=${pushTitle(push) + " (Shift+P)"} onClick=${() => perform("push")}>${push.label}<//>`
      : html`<${Button} variant="ghost" size="sm" class="tool" data-tool="push" disabled title="Nothing to push (Shift+P)"><span class="glyph" aria-hidden="true">↑</span><span class="tool-label">Push</span><//>`}
    <${Tool} id="branch" ctx=${ctx} perform=${perform} label="Branch" glyph="⎇" />
    <span class="tool-sep" aria-hidden="true"></span>
    <${Tool} id="stash" ctx=${ctx} perform=${perform} label="Stash" glyph="▤" /><${Tool} id="stash-pop" ctx=${ctx} perform=${perform} label="Pop" glyph="▥" />
    <span class="tool-sep" aria-hidden="true"></span>
    <${Button} variant="secondary" size="sm" class="tool tool-sync" data-tool="sync-smart" disabled=${!!planReason} title=${"What is next: " + plan.label + (planReason ? " — " + planReason : "")} onClick=${() => perform(plan.id)}><span class="glyph" aria-hidden="true">⟳</span><span class="tool-label">${plan.id === "fetch" ? "Sync" : plan.label}</span><//>
    <span class="grow"></span>
    <${Tool} id="log" ctx=${ctx} perform=${perform} label="Log" glyph="☰" always />
    <${Button} variant="ghost" size="sm" class="tool" data-tool="palette" title="Every action (Ctrl+K)" aria-label="Every action (Ctrl+K)" onClick=${() => perform("palette")}><span class="glyph" aria-hidden="true">⌘</span><span class="tool-label">Actions</span><//>
    <${Search} class="tool-search" wrapClass="tool-search-wrap" inputRef=${searchRef} placeholder="Search commits (Ctrl+F)" aria-label="Search commits" value=${search} onInput=${e => setSearch(e.target.value)} onKeyDown=${e => e.key === "Escape" && (setSearch(""), e.target.blur())} />
  </div>`;
}
