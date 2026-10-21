/* The dialogs of the larger actions: interactive rebase, the stash, worktrees, what was changed, compare, patches, shortcuts. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { SHORTCUTS, validBranchName } from "../ops.js";
import { shortHash } from "../logic.js";
import { Alert, Badge, Button, Field, Input, Modal, Output } from "./ui.js";

const STEPS = [["pick", "Keep"], ["reword", "Reword"], ["squash", "Squash into the one before"], ["fixup", "Fixup (drop its message)"], ["drop", "Drop"]];

/* line: the commits to replay, oldest first (the first one is where the rewrite starts). */
export function RewriteDialog({ line, onSubmit, onClose }) {
  const [rows, setRows] = useState(() => line.map(c => ({ commit: c, action: "pick", message: c.subject })));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const next = rows.slice(); [next[i], next[j]] = [next[j], next[i]]; setRows(next); };
  const change = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const firstKept = rows.find(r => r.action !== "drop");
  const problem = !firstKept ? "keep at least one commit" : ["squash", "fixup"].includes(firstKept.action) ? "the first commit kept cannot be squashed: there is nothing before it" : rows.some(r => r.action === "reword" && !r.message.trim()) ? "a reworded commit needs a message" : "";
  const submit = () => onSubmit({ base: line[0].parents[0], plan: rows.map(r => ({ action: r.action, commit: r.commit.sha, ...(r.action === "reword" ? { message: r.message.trim() } : {}) })) });
  return html`<${Modal} title="Interactive rebase" wide onClose=${onClose} footer=${html`${problem ? html`<span class="field-hint warn grow" role="alert">${problem}</span>` : null}<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!!problem} onClick=${submit}>Continue<//>`}>
    <p class="hint">Oldest first. Move commits, choose what happens to each, then look at the preview. Only commits that are not on a remote can be rewritten.</p>
    <ol class="plan">${rows.map((r, i) => html`<li class=${"plan-row plan-" + r.action}>
      <span class="plan-move"><button type="button" class="icon-btn" aria-label=${"Move " + shortHash(r.commit.sha) + " earlier"} disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button><button type="button" class="icon-btn" aria-label=${"Move " + shortHash(r.commit.sha) + " later"} disabled=${i === rows.length - 1} onClick=${() => move(i, 1)}>↓</button></span>
      <select class="input" aria-label=${"What to do with " + shortHash(r.commit.sha)} value=${r.action} onChange=${e => change(i, { action: e.target.value })}>${STEPS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <code>${shortHash(r.commit.sha)}</code>
      ${r.action === "reword" ? html`<input class="input mono" aria-label=${"New message of " + shortHash(r.commit.sha)} value=${r.message} onInput=${e => change(i, { message: e.target.value })} />` : html`<span class="msg" title=${r.commit.subject}>${r.commit.subject}</span>`}
    </li>`)}</ol>
  <//>`;
}

/* The stash: what is in it, and what to do with each entry. */
export function StashDialog({ repoId, onAction, onClose, notify }) {
  const [list, setList] = useState(null);
  const [diff, setDiff] = useState(null);
  useEffect(() => { api("GET", "repos/" + repoId + "/stashes").then(d => setList(d.stashes)).catch(e => { setList([]); notify({ variant: "error", title: "Cannot read the stash", detail: e.message }); }); }, []);
  const view = async s => { try { setDiff({ index: s.index, text: (await api("GET", "repos/" + repoId + "/stashes/" + s.index)).diff }); } catch (e) { notify({ variant: "error", title: "Cannot show it", detail: e.message }); } };
  return html`<${Modal} title="Stashes" wide onClose=${onClose}>
    ${list === null ? html`<p class="hint">Loading…</p>` : list.length === 0 ? html`<p class="hint">The stash is empty. “Stash changes” puts your uncommitted work aside.</p>` : html`<ul class="stash-list">${list.map(s => html`<li>
      <span class="mono">stash@{${s.index}}</span><span class="msg" title=${s.message}>${s.message}</span><span class="hint">${(s.date || "").replace("T", " ").slice(0, 16)}</span>
      <span class="row-actions"><${Button} size="sm" variant="ghost" onClick=${() => view(s)}>View<//><${Button} size="sm" variant="ghost" onClick=${() => onAction("apply", s.index)}>Apply<//><${Button} size="sm" variant="ghost" onClick=${() => onAction("pop", s.index)}>Pop<//><${Button} size="sm" variant="ghost" onClick=${() => onAction("drop", s.index)}>Drop<//></span></li>`)}</ul>`}
    ${diff ? html`<h3 class="sub">stash@{${diff.index}}</h3><${Output}>${diff.text || "(no changes)"}<//>` : null}
  <//>`;
}

/* Other folders with a branch checked out. */
export function WorktreesDialog({ repoId, branches, onRun, onClose, notify }) {
  const [list, setList] = useState(null);
  const [path, setPath] = useState(""), [branch, setBranch] = useState(""), [from, setFrom] = useState("");
  useEffect(() => { api("GET", "repos/" + repoId + "/worktrees").then(d => setList(d.worktrees)).catch(e => { setList([]); notify({ variant: "error", title: "Cannot list the worktrees", detail: e.message }); }); }, []);
  const b = branch.trim();
  const exists = ((branches && branches.local) || []).some(x => x.name === b);
  const problem = !path.trim().startsWith("/") ? "the folder must be an absolute path" : !validBranchName(b) ? "give a branch name" : !exists && !from.trim() ? "that branch does not exist: say where to start it from" : "";
  return html`<${Modal} title="Worktrees" wide onClose=${onClose}>
    ${list === null ? html`<p class="hint">Loading…</p>` : html`<ul class="stash-list">${list.map(w => html`<li><span class="mono msg" title=${w.path}>${w.path}</span><${Badge} tone=${w.main ? "info" : "neutral"}>${w.branch || "(detached)"}<//><code>${w.head}</code>
      ${w.main ? html`<span class="hint">main folder</span>` : html`<${Button} size="sm" variant="ghost" onClick=${() => onRun("worktree-remove", { path: w.path }, "Remove " + w.path, true)}>Remove<//>`}</li>`)}</ul>`}
    <h3 class="sub">Add one</h3>
    <${Field} label="Folder" hint="outside the repository, absolute"><${Input} class="mono" value=${path} placeholder="/home/you/work/feature" onInput=${e => setPath(e.target.value)} /><//>
    <${Field} label="Branch"><${Input} class="mono" list="wt-branches" value=${branch} onInput=${e => setBranch(e.target.value)} /><//>
    <datalist id="wt-branches">${((branches && branches.local) || []).map(x => html`<option value=${x.name}></option>`)}</datalist>
    ${!exists && b ? html`<${Field} label="Start the new branch from" hint="a branch or a commit id"><${Input} class="mono" value=${from} placeholder="origin/staging" onInput=${e => setFrom(e.target.value)} /><//>` : null}
    <div class="actions"><${Button} disabled=${!!problem} title=${problem} onClick=${() => onRun("worktree-add", { path: path.trim(), branch: b, ...(from.trim() && !exists ? { new_from: from.trim() } : {}) }, "Add a worktree at " + path.trim())}>Add worktree<//>${problem && (path || branch) ? html`<span class="field-hint warn">${problem}</span>` : null}</div>
  <//>`;
}

/* What git-shuttle changed here, newest first, with Undo and Redo. */
export function JournalDialog({ repoId, status, onAction, onClose, notify }) {
  const [list, setList] = useState(null);
  useEffect(() => { api("GET", "repos/" + repoId + "/journal").then(d => setList(d.journal)).catch(e => { setList([]); notify({ variant: "error", title: "Cannot read the journal", detail: e.message }); }); }, []);
  return html`<${Modal} title="What was changed here" wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Close<//><${Button} variant="outline" disabled=${!status["journal.redo"]} onClick=${() => onAction("redo")}>Redo ${status["journal.redo"] || ""}<//><${Button} disabled=${!status["journal.undo"]} onClick=${() => onAction("undo")}>Undo ${status["journal.undo"] || ""}<//>`}>
    <p class="hint">Only what git-shuttle did in this repository. Undo puts branches, tags and HEAD back, and only when that is safe (nothing pushed, nothing moved since).</p>
    ${list === null ? html`<p class="hint">Loading…</p>` : list.length === 0 ? html`<p class="hint">Nothing yet.</p>` : html`<ul class="stash-list">${list.map(e => html`<li><span class="mono">${e.command}</span><span class="msg" title=${e.summary}>${e.summary}</span><span class="hint">${(e.time || "").replace("T", " ")}</span><${Badge} tone=${e.state === "done" ? "ok" : "neutral"}>${e.state}<//></li>`)}</ul>`}
  <//>`;
}

/* The commits and files that differ between two branches or commits. */
export function CompareDialog({ repoId, branches, a: first, b: second, onClose, notify }) {
  const [a, setA] = useState(first || ""), [b, setB] = useState(second || "HEAD");
  const [data, setData] = useState(null);
  const names = [...((branches && branches.local) || []), ...((branches && branches.remote) || [])].map(x => x.name);
  const go = async (x = a, y = b) => { if (!x) return; try { setData(await api("POST", "repos/" + repoId + "/compare", { a: x, b: y })); } catch (e) { setData(null); notify({ variant: "error", title: "Cannot compare", detail: e.message }); } };
  useEffect(() => { go(); }, []);
  return html`<${Modal} title="Compare" wide onClose=${onClose}>
    <div class="compare-pick"><${Field} label="From"><${Input} class="mono" list="cmp-names" value=${a} onInput=${e => setA(e.target.value)} onKeyDown=${e => e.key === "Enter" && go()} /><//>
      <${Field} label="To"><${Input} class="mono" list="cmp-names" value=${b} onInput=${e => setB(e.target.value)} onKeyDown=${e => e.key === "Enter" && go()} /><//>
      <${Button} onClick=${() => go()}>Compare<//></div>
    <datalist id="cmp-names">${names.map(n => html`<option value=${n}></option>`)}</datalist>
    ${data ? html`<p><strong>${data.b}</strong> is ${data.ahead} ahead of and ${data.behind} behind <strong>${data.a}</strong>.</p>
      <div class="compare-cols"><div><h3 class="sub">Only in ${data.b} (${data.ahead})</h3><ul class="plain">${data.ahead_commits.map(c => html`<li><code>${c.hash}</code> ${c.subject}</li>`)}</ul></div>
        <div><h3 class="sub">Only in ${data.a} (${data.behind})</h3><ul class="plain">${data.behind_commits.map(c => html`<li><code>${c.hash}</code> ${c.subject}</li>`)}</ul></div></div>
      <h3 class="sub">Files changed in ${data.b} since the common ancestor (${data.files.length})</h3><ul class="plain mono">${data.files.map(f => html`<li><span class=${"st st-" + f.status}>${f.status}</span> ${f.path}${f.old_path ? " ← " + f.old_path : ""}</li>`)}</ul>` : html`<p class="hint">Choose two branches or commits.</p>`}
  <//>`;
}

/* A commit as a patch: copy it or save it as a file; nothing is written on the machine by the server. */
export function PatchDialog({ repoId, commit, onClose, onCopy, notify }) {
  const [text, setText] = useState(null);
  useEffect(() => { api("GET", "repos/" + repoId + "/commits/" + commit.sha + "/patch").then(d => setText(d.patch)).catch(e => { setText(""); notify({ variant: "error", title: "Cannot make the patch", detail: e.message }); }); }, []);
  const save = () => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = shortHash(commit.sha) + ".patch"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return html`<${Modal} title=${"Patch of " + shortHash(commit.sha)} wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Close<//><${Button} variant="outline" disabled=${!text} onClick=${() => onCopy(text)}>Copy<//><${Button} disabled=${!text} onClick=${save}>Save as a file<//>`}>
    <p class="hint">${commit.subject}. Apply it elsewhere with “Apply a patch”.</p>
    ${text === null ? html`<p class="hint">Loading…</p>` : html`<${Output}>${text}<//>`}
  <//>`;
}

export function ShortcutsDialog({ onClose }) {
  return html`<${Modal} title="Keyboard shortcuts" onClose=${onClose}>
    <table class="shortcuts"><tbody>${SHORTCUTS.map(s => html`<tr><td><kbd>${s.keys}</kbd></td><td>${s.text}</td></tr>`)}</tbody></table>
  <//>`;
}
