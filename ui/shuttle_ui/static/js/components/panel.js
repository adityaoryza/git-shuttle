/* The action panel: Start a task, Ship it, Release it. Each ends in one button: Preview, then Run. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { groupByModule, messageProblem, moduleOf, pathsToStage, shipParams, shortHash, upgradeCommand } from "../logic.js";
import { refusedForChanges, startPlan, whereLine, willDo } from "../tabs.js";
import { FileRow } from "./file-row.js";
import { Alert, Badge, Button, Field, Input, Output, Segmented, cn } from "./ui.js";

// ---- what the repository says, in the words of the settings
export function settings(status) {
  const s = status || {};
  return {
    messagePattern: s["config.messagePattern"] || "", forbidTrailers: s["config.forbidTrailers"] || "",
    upgradeCommand: s["config.upgradeCommand"] || "", branchPrefix: s["config.branchPrefix"] || "",
    integration: s["config.integration"] || s["config.base"] || "", release: s["config.release"] || s["config.base"] || "",
  };
}

// ---- the preview and the result of a run
function PreviewBox({ runner, action }) {
  const p = runner.shown;
  if (!p || p.action !== action) return null;
  return html`<details class="preview" open>
    <summary>${p.ok ? "Exactly what will run" : "Refused"}</summary>
    <${Output}>${p.steps.map(s => "# git shuttle " + s.argv.slice(0, 2).join(" ") + "\n" + s.output).join("\n")}<//>
  </details>`;
}

function ActionBar({ runner, action, params, label, disabled, children }) {
  const ready = runner.fresh(action, params);
  return html`<div class="actions">
    ${ready
      ? html`<${Button} onClick=${() => runner.run(action, params, label)} disabled=${runner.busy || disabled}>${label}<//>`
      : html`<${Button} onClick=${() => runner.preview(action, params)} disabled=${runner.busy || disabled}>Preview<//>`}
    ${ready ? html`<span class="hint">Looks right? Run it.</span>` : html`<span class="hint">Preview shows exactly what will run.</span>`}
    ${children}
  </div>`;
}

// what a step is called: a commit by its message, the rest by command
const stepLabel = argv => (argv[0] === "commit" ? "commit " + JSON.stringify(argv[2]) : argv[0] === "init" ? "save the settings (git shuttle init)" : "git shuttle " + argv.slice(0, 2).join(" "));

export function ResultCard({ runner, onPullRequest }) {
  const j = runner.job;
  if (!j) return null;
  const tone = j.state === "done" ? "ok" : j.state === "running" ? "neutral" : "bad";
  const check = html`<svg class="check-draw" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;
  return html`<section class="result" tabIndex="-1">
    <header>${j.state === "done" ? check : null}<strong>${j.label}</strong><${Badge} tone=${tone}>${j.state}<//><span class="grow" /><${Button} variant="ghost" size="icon" onClick=${runner.closeJob} aria-label="Dismiss">✕<//></header>
    <ol class="steps">${(j.steps || []).map(s => html`<li class=${"step-" + s.state}><code>${stepLabel(s.argv)}</code></li>`)}</ol>
    ${(j.steps || []).some(s => s.output) ? html`<details open=${j.state !== "done"}><summary class="hint">Output</summary>
      ${(j.steps || []).filter(s => s.output).map(s => html`<${Output}>${s.output}<//>`)}</details>` : null}
    ${j.state === "stopped" ? html`<p class="hint">The repository was left mid-operation. Resolve it in the banner above.</p>` : null}
    ${j.state === "done" && j.action === "release" ? html`<${Button} variant="secondary" onClick=${onPullRequest}>Open a pull request<//>` : null}
  </section>`;
}

// ---- stopped half way
export function OperationBanner({ status, runner, confirm }) {
  if (!status || !status.operation) return null;
  const abort = async () => {
    if (await confirm({ title: "Abort the " + status.operation + "?", body: "The repository returns to how it was before it started.", confirmLabel: "Abort", tone: "destructive" })) runner.run("abort", {}, "Abort");
  };
  return html`<${Alert} tone="bad" title=${"Stopped: a " + status.operation + " is waiting"}>
    <p>Nothing was forced and nothing was pushed. Resolve the conflicts in your editor, save, then continue.</p>
    ${status.conflict.length ? html`<ul class="files">${status.conflict.map(f => html`<li><code>${f}</code></li>`)}</ul>` : null}
    <div class="actions"><${Button} onClick=${() => runner.run("continue", {}, "Continue")} disabled=${runner.busy}>Mark resolved and continue<//><${Button} variant="destructive" onClick=${abort} disabled=${runner.busy}>Abort<//></div>
    <p class="hint">After continuing, run Ship again (without a new message) to finish the rest.</p>
  <//>`;
}

// ---- 1. start a task
export function StartTab({ status, branches, runner, onContinue, onSwitch }) {
  const c = settings(status);
  const [name, setName] = useState("");
  const [choice, setChoice] = useState("stash");     // what to do with uncommitted changes: the safe one is the default
  const plan = startPlan({ status, branches, name, prefix: c.branchPrefix || "feature/", choice });
  const { here } = plan;
  const from = here.integrationRef || (c.integration ? "origin/" + c.integration : "");
  const choose = value => { setChoice(value); runner.clearPreview(); };
  const refused = refusedForChanges(runner.shown) && runner.shown.key === JSON.stringify(["start", plan.params]);
  const withChoice = value => { setChoice(value); runner.preview("start", { name, [value]: true }); };
  const existsText = plan.exists === "local" ? "A branch called " + plan.branch + " already exists here." : "A branch called " + plan.branch + " exists on the remote.";
  return html`<div class="tab">
    <p class="state-line">${whereLine(here)}</p>
    ${plan.onTask ? html`<div class="continue-card">
      <div><strong>You are working on ${here.branch}</strong>
        <span class="hint">${here.changes ? here.changes + " uncommitted" : "nothing uncommitted"}${here.ahead ? " · ↑" + here.ahead + " to ship" : ""}</span></div>
      <${Button} variant="secondary" size="sm" onClick=${onContinue}>Continue here<//>
    </div>` : null}
    <span class="section">${plan.onTask ? "Start another task" : "Start a task"}</span>
    <p class="lead">One branch per task. ${willDo(here, plan.branch, from, choice)}</p>
    <${Field} label="Task name"><${Input} value=${name} placeholder="e.g. keep manual order date" onInput=${e => { setName(e.target.value); runner.clearPreview(); }} /><//>
    <p class="hint">Branch: <code>${plan.branch || "—"}</code></p>
    ${plan.exists ? html`<${Alert} tone="warn"><span>${existsText}</span>
      <div class="actions"><${Button} variant="secondary" size="sm" onClick=${() => onSwitch(plan.branch)}>Switch to it<//></div><//>` : null}
    ${plan.needsChoice && !plan.exists ? html`<fieldset class="choice">
      <legend>Your ${here.tracked === 1 ? "uncommitted change" : here.tracked + " uncommitted changes"} to tracked files</legend>
      <label class="check"><input type="radio" name="changes" checked=${choice === "stash"} onChange=${() => choose("stash")} /><span><strong>Stash them first</strong><br /><span class="hint">kept in the stash list, named after the branch (new files stay where they are)</span></span></label>
      <label class="check"><input type="radio" name="changes" checked=${choice === "carry"} onChange=${() => choose("carry")} /><span><strong>Take them along</strong><br /><span class="hint">git decides: it stops cleanly, changing nothing, if they conflict</span></span></label>
    </fieldset>` : null}
    <${ActionBar} runner=${runner} action="start" params=${plan.params} label="Create branch" disabled=${!plan.canCreate}>
      ${plan.needsChoice || name ? html`<${Button} variant="ghost" size="sm" onClick=${() => { setName(""); runner.clearPreview(); }}>Cancel<//>` : null}
    <//>
    <${PreviewBox} runner=${runner} action="start" />
    ${refused ? html`<div class="actions"><${Button} variant="secondary" size="sm" onClick=${() => withChoice("stash")}>Stash and start<//><${Button} variant="secondary" size="sm" onClick=${() => withChoice("carry")}>Take changes along<//></div>` : null}
  </div>`;
}

// ---- 2. ship: one commit per module, then sync, push and merge (or a pull request)
export function useGroups(status) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    const fresh = groupByModule((status && status.file) || []);
    setGroups(old => {
      const byModule = new Map(old.map(g => [g.module, g]));
      const order = old.map(g => g.module);
      fresh.sort((a, b) => (order.indexOf(a.module) < 0 ? 1e6 : order.indexOf(a.module)) - (order.indexOf(b.module) < 0 ? 1e6 : order.indexOf(b.module)) || a.module.localeCompare(b.module));
      return fresh.map(g => {
        const prev = byModule.get(g.module);
        const draft = "[FEAT] " + (g.module === "(root)" ? "root" : g.module) + ": ";
        return { ...g, include: prev ? prev.include : true, message: prev ? prev.message : draft, draft: prev ? prev.draft : draft };
      });
    });
  }, [status]);
  return [groups, setGroups];
}

const SECTION_LABEL = { staged: "staged", unstaged: "", untracked: "new" };

// The files of a module as the working tree has them (a file can be both staged and changed again): from /worktree.
export function moduleFiles(worktree, module) {
  if (!worktree) return [];
  return ["staged", "unstaged", "untracked"].flatMap(group => (worktree[group] || []).filter(f => moduleOf(f.path) === module).map(f => ({ ...f, group })));
}

function GroupBox({ g, index, count, cfg, update, move, files, onOpenFile }) {
  const problem = g.include ? messageProblem(g.message, cfg) : "";
  const untouched = g.message === g.draft;   // do not scold a message that is still the suggested start
  return html`<div class=${cn("group", !g.include && "group-off")}>
    <div class="group-head">
      <input type="checkbox" checked=${g.include} onChange=${e => update(index, { include: e.target.checked })} aria-label=${"Include " + g.module} />
      <strong>${g.module}</strong><span class="hint">${g.files.length} ${g.files.length === 1 ? "file" : "files"}</span><span class="grow" />
      <${Button} variant="ghost" size="icon" disabled=${index === 0} onClick=${() => move(index, -1)} aria-label="Move up">↑<//>
      <${Button} variant="ghost" size="icon" disabled=${index === count - 1} onClick=${() => move(index, 1)} aria-label="Move down">↓<//>
    </div>
    ${files.length ? html`<details class="group-files" open=${files.length <= 4}>
      <summary>Files · ${files.length}</summary>
      <div class="group-file-list">${files.map(f => html`<${FileRow} file=${f} plain tag=${SECTION_LABEL[f.group]} onPick=${() => onOpenFile({ path: f.path, group: f.group })} />`)}</div>
      <button type="button" class="link" onClick=${() => onOpenFile({ path: files[0].path, group: files[0].group })}>View all changes of this module</button>
    </details>` : null}
    <${Input} class=${cn("mono", g.include && !untouched && (problem ? "invalid" : "valid"))} value=${g.message} disabled=${!g.include} onInput=${e => update(index, { message: e.target.value })} />
    ${g.include && problem && !untouched ? html`<span class="field-hint bad">${problem}</span>` : html`<span class="field-hint">${untouched && g.include ? "Finish the message: [TAG] module: what changed" : ""}</span>`}
  </div>`;
}

export function ShipTab({ status, runner, groups, setGroups, tested, setTested, worktree, onOpenFile }) {
  const c = settings(status);
  const [how, setHow] = useState("merge");
  const [pr, setPr] = useState({ title: "", body: "", draft: false });
  const included = groups.filter(g => g.include);
  const update = (i, patch) => { setGroups(groups.map((g, n) => (n === i ? { ...g, ...patch } : g))); runner.clearPreview(); };
  const move = (i, d) => { const a = groups.slice(); [a[i], a[i + d]] = [a[i + d], a[i]]; setGroups(a); runner.clearPreview(); };

  let blockers = (status.blocker || []).slice();
  if (included.length) blockers = blockers.filter(b => !b.startsWith("nothing to ship"));
  const problems = [...blockers];
  for (const g of included) { const p = messageProblem(g.message, c); if (p) problems.push(g.module + ": " + p); }
  if (how === "pr" && !(pr.title || (included[0] && included[0].message))) problems.push("the pull request title is empty");
  const untested = !!c.upgradeCommand && !tested;

  const title = pr.title || (included[0] ? included[0].message.split("\n")[0] : "");
  const params = shipParams(groups, how === "pr" ? { pr: true, title, body: pr.body, draft: pr.draft } : null);
  const stage = pathsToStage(groups);
  if (stage.length) params.stage = stage;
  const modules = groups.filter(g => g.module !== "(root)");
  const cmd = modules.length ? upgradeCommand(c.upgradeCommand, modules) : c.upgradeCommand;   // no module yet: show the template
  const into = c.integration || "the integration branch";

  return html`<div class="tab">
    ${groups.length ? html`<div class="stack">
      <span class="section">Commits <span class="hint">one per module — order them by dependency</span></span>
      ${groups.map((g, i) => html`<${GroupBox} g=${g} index=${i} count=${groups.length} cfg=${c} update=${update} move=${move} files=${moduleFiles(worktree, g.module)} onOpenFile=${onOpenFile} />`)}
    </div>` : html`<p class="lead">No uncommitted changes. Ship sends the commits this branch already has.</p>`}

    ${c.upgradeCommand ? html`<div class="stack">
      <span class="section">Test first <span class="hint">copy it to your terminal — the UI never runs it</span></span>
      <${Output}>${cmd || c.upgradeCommand}<//>
      <div class="actions"><${Button} variant="outline" size="sm" onClick=${() => navigator.clipboard && navigator.clipboard.writeText(cmd || c.upgradeCommand)}>Copy<//>
        <label class="check"><input type="checkbox" checked=${tested} onChange=${e => setTested(e.target.checked)} /> I tested it</label></div>
    </div>` : null}

    <div class="stack">
      <span class="section">Destination</span>
      <${Segmented} value=${how} onChange=${v => { setHow(v); runner.clearPreview(); }} options=${[{ value: "merge", label: "Merge into " + into }, { value: "pr", label: "Pull request" }]} />
      ${how === "pr" ? html`<${Field} label="Title" hint="empty = first commit message"><${Input} value=${pr.title} onInput=${e => { setPr({ ...pr, title: e.target.value }); runner.clearPreview(); }} /><//>
        <${Field} label="Description"><textarea class="input" rows="4" value=${pr.body} onInput=${e => { setPr({ ...pr, body: e.target.value }); runner.clearPreview(); }} /><//>
        <label class="check"><input type="checkbox" checked=${pr.draft} onChange=${e => { setPr({ ...pr, draft: e.target.checked }); runner.clearPreview(); }} /> Draft</label>` : null}
    </div>

    ${problems.length ? html`<${Alert} tone="warn" title="Cannot run yet"><ul>${problems.map(p => html`<li>${p}</li>`)}</ul><//>` : null}
    ${untested && !problems.length ? html`<p class="hint">Tick “I tested it” to enable Run.</p>` : null}
    <${ActionBar} runner=${runner} action="ship" params=${params} label=${how === "pr" ? "Open pull request" : "Merge into " + into} disabled=${problems.length > 0} />
    <${PreviewBox} runner=${runner} action="ship" />
  </div>`;
}

// ---- 3. release: pick commits from what was merged, in order
export function ReleaseTab({ repoId, status, runner, onError, onLoaded }) {
  const c = settings(status);
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [push, setPush] = useState(true);
  const [strategy, setStrategy] = useState("");

  async function load() {
    try {
      await api("POST", "repos/" + repoId + "/fetch", {});
      const found = (await api("GET", "repos/" + repoId + "/candidates")).candidates;
      const st = (await api("GET", "repos/" + repoId + "/status")).status;
      // all at once: nothing can be picked before the list is complete, and nothing picked is wiped afterwards
      setName(st["suggest.release"] || "auto");
      setPicked([]);
      setCandidates(found);
      onLoaded();
    } catch (e) { onError(e); }
  }
  useEffect(() => { load(); }, [repoId]);

  const toggle = (merge, commit, on) => { setPicked(on ? [...picked, { hash: commit.hash, subject: commit.subject }] : picked.filter(p => p.hash !== commit.hash)); runner.clearPreview(); };
  const move = (i, d) => { const a = picked.slice(); [a[i], a[i + d]] = [a[i + d], a[i]]; setPicked(a); runner.clearPreview(); };
  const params = { onto: name || "auto", commits: picked.map(p => p.hash), push, strategy: strategy || undefined };

  if (candidates === null) return html`<div class="tab"><p class="hint">Loading what was merged…</p></div>`;
  const merges = candidates.slice().reverse();   // oldest first
  return html`<div class="tab">
    <p class="lead">Pick the commits to release, from <code>${c.release || "the release branch"}</code>. They are cherry-picked in the order you set.</p>
    ${merges.length === 0 ? html`<p class="hint">Nothing has been merged into ${c.integration || "the integration branch"} since the last release.</p>` : null}
    ${merges.map(m => html`<div class="group"><div class="group-head"><strong>${m.subject}</strong><span class="grow" /><span class="hint">${(m.date || "").slice(0, 10)}</span></div>
      ${m.commits.map(cm => html`<label class="check pick"><input type="checkbox" disabled=${!cm.pending} checked=${picked.some(p => p.hash === cm.hash)} onChange=${e => toggle(m, cm, e.target.checked)} />
        <code>${shortHash(cm.hash)}</code><span class="msg">${cm.subject}</span>${!cm.pending ? html`<${Badge}>released<//>` : null}</label>`)}</div>`)}
    ${picked.length ? html`<div class="stack">
      <span class="section">Order on the release branch</span>
      ${picked.map((p, i) => html`<div class="pickrow"><span class="num">${i + 1}</span><code>${shortHash(p.hash)}</code><span class="msg">${p.subject}</span>
        <${Button} variant="ghost" size="icon" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move up">↑<//><${Button} variant="ghost" size="icon" disabled=${i === picked.length - 1} onClick=${() => move(i, 1)} aria-label="Move down">↓<//></div>`)}
      <${Field} label="Release branch" hint="auto = the pattern from Settings"><${Input} class="mono" value=${name} onInput=${e => { setName(e.target.value); runner.clearPreview(); }} /><//>
      <details class="advanced"><summary>Advanced</summary>
        <label class="check"><input type="checkbox" checked=${push} onChange=${e => { setPush(e.target.checked); runner.clearPreview(); }} /> Push the branch</label>
        <${Field} label="On conflict"><select class="input" value=${strategy} onChange=${e => { setStrategy(e.target.value); runner.clearPreview(); }}>
          <option value="">Stop and show me</option><option value="theirs">Take the picked commit</option><option value="ours">Keep the release branch</option></select><//>
      </details>
      <${ActionBar} runner=${runner} action="release" params=${params} label="Create release branch" />
      <${PreviewBox} runner=${runner} action="release" />
    </div>` : null}
  </div>`;
}
