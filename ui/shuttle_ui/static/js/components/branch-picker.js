/* The branch picker: where you are, a way to switch, and which branches the graph shows (like the side bar of a git client).
 * Branches are grouped in folders by the part of the name before the first "/", each folder with its own eye. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { groupBranches } from "../branches.js";
import { Button, Input, cn } from "./ui.js";

const Icon = ({ d, children, size = 16 }) => html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d ? html`<path d=${d} />` : null}${children}</svg>`;
const EyeIcon = ({ off }) => html`<${Icon}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />${off ? html`<path d="M4 4l16 16" />` : null}<//>`;
const Chevron = ({ open }) => html`<${Icon} size=${14}><path d=${open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} /><//>`;

function EyeToggle({ state, onClick, label }) {
  // state: "all" | "some" | "none" of what is shown
  return html`<button type="button" class=${cn("eye", "eye-" + state)} onClick=${onClick} aria-label=${label} title=${label}><${EyeIcon} off=${state === "none"} /></button>`;
}

function BranchRow({ item, hidden, onToggle, onSwitch, remote, indent, refsOf }) {
  const { b, leaf } = item;
  const off = hidden.has(b.ref);
  return html`<div class=${cn("pick-row", b.current && "pick-current", indent && "indent")}>
    <${EyeToggle} state=${off ? "none" : "all"} onClick=${() => onToggle(refsOf(b))} label=${(off ? "Show " : "Hide ") + b.name + " in the graph"} />
    <button type="button" class=${cn("pick-name", off && "dim")} onClick=${() => !b.current && onSwitch(b.name)} title=${b.name + (b.current ? " — you are here" : remote ? " — check out a local copy" : " — switch to it")}>
      <span class="mono">${leaf}</span>${b.current ? html`<span class="badge badge-info">current</span>` : null}
    </button>
  </div>`;
}

function shownState(list, hidden) {
  const off = list.filter(b => hidden.has(b.ref)).length;
  return off === 0 ? "all" : off === list.length ? "none" : "some";
}

function Section({ title, list, hidden, setRefs, onSwitch, remote, open, setOpen, forceOpen, closedFolders, toggleFolder, refsOf }) {
  const { root, folders } = groupBranches(list);
  const isOpen = open || forceOpen;
  const state = shownState(list, hidden);
  return html`<section class="pick-section">
    <div class="pick-head">
      <button type="button" class="pick-toggle" onClick=${() => setOpen(!open)} aria-expanded=${isOpen}><${Chevron} open=${isOpen} /><span>${title}</span><span class="count">${list.length - list.filter(b => hidden.has(b.ref)).length}/${list.length}</span></button>
      <${EyeToggle} state=${state} onClick=${() => setRefs(list.flatMap(refsOf), state === "none")} label=${(state === "none" ? "Show all " : "Hide all ") + title.toLowerCase() + " branches"} />
    </div>
    ${isOpen ? html`<div class="pick-body">
      ${list.length === 0 ? html`<p class="hint pad">Nothing matches.</p>` : null}
      ${root.map(item => html`<${BranchRow} item=${item} hidden=${hidden} onToggle=${refs => setRefs(refs)} onSwitch=${onSwitch} remote=${remote} refsOf=${refsOf} />`)}
      ${folders.map(([name, items]) => {
        const key = title + ":" + name, fOpen = forceOpen || !closedFolders.has(key), fState = shownState(items.map(i => i.b), hidden);
        return html`<div class="pick-folder">
          <div class="pick-folder-head">
            <${EyeToggle} state=${fState} onClick=${() => setRefs(items.flatMap(i => refsOf(i.b)), fState === "none")} label=${(fState === "none" ? "Show all in " : "Hide all in ") + name + "/"} />
            <button type="button" class="pick-toggle" onClick=${() => toggleFolder(key)} aria-expanded=${fOpen}><${Chevron} open=${fOpen} /><span class="mono">${name}/</span><span class="count">${items.length}</span></button>
          </div>
          ${fOpen ? items.map(item => html`<${BranchRow} item=${item} hidden=${hidden} onToggle=${refs => setRefs(refs)} onSwitch=${onSwitch} remote=${remote} indent refsOf=${refsOf} />`) : null}
        </div>`;
      })}
    </div>` : null}
  </section>`;
}

export function BranchPicker({ status, branches, hidden, setHidden, onSwitch, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState({ Local: true, Remote: false });
  const [closedFolders, setClosedFolders] = useState(new Set());
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  const current = (status && status.branch) || "(detached)";
  const q = query.trim().toLowerCase();
  const match = b => !q || b.name.toLowerCase().includes(q);
  const local = ((branches && branches.local) || []).filter(match);
  const remote = ((branches && branches.remote) || []).filter(match);
  // refs: the list to change; show: true shows them, false hides them, undefined toggles each one
  const setRefs = (refs, show) => {
    const next = new Set(hidden);
    refs.forEach(r => { const makeShown = show === undefined ? next.has(r) : show; makeShown ? next.delete(r) : next.add(r); });
    setHidden(next);
  };
  const toggleFolder = key => { const next = new Set(closedFolders); next.has(key) ? next.delete(key) : next.add(key); setClosedFolders(next); };
  const pick = name => { setOpen(false); onSwitch(name); };
  // a local branch and the remote branch it tracks are one entry: hiding one hides the other, or the graph would still show it
  const remoteRefs = new Set(((branches && branches.remote) || []).map(b => b.ref));
  const refsOf = b => (b.upstream && remoteRefs.has("refs/remotes/" + b.upstream) ? [b.ref, "refs/remotes/" + b.upstream] : [b.ref]);
  const common = { refsOf, hidden, setRefs, onSwitch: pick, closedFolders, toggleFolder, forceOpen: !!q };

  return html`<div class="picker" ref=${box}>
    <${Button} variant="outline" size="sm" class="branch-btn" onClick=${() => setOpen(!open)} aria-expanded=${open} aria-haspopup="dialog" disabled=${disabled} title="Current branch: switch branch or choose what the graph shows">
      <span class="branch-icon" aria-hidden="true">⎇</span><span class="mono branch-name">${current}</span><${Chevron} open=${open} />
    <//>
    ${open ? html`<div class="popover" role="dialog" aria-label="Branches">
      <${Input} autofocus placeholder="Filter branches…" value=${query} onInput=${e => setQuery(e.target.value)} />
      <div class="pick-scroll">
        <${Section} title="Local" list=${local} open=${sections.Local} setOpen=${v => setSections({ ...sections, Local: v })} ...${common} />
        <${Section} title="Remote" list=${remote} remote open=${sections.Remote} setOpen=${v => setSections({ ...sections, Remote: v })} ...${common} />
      </div>
      <div class="pick-foot"><span class="hint"><${EyeIcon} /> shown in the graph · <${EyeIcon} off /> hidden · click a name to switch</span>
        ${hidden.size ? html`<button type="button" class="link" onClick=${() => setHidden(new Set())}>Show everything</button>` : null}</div>
    </div>` : null}
  </div>`;
}
