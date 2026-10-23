/* The action panel: Start a task, Ship it, Release it. Each ends in one button: Preview, then Run. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { GH_MISSING, branchOptions, conflictChoices, conflictCode, conflictSidesLine, ghMissing, groupByModule, hasMarkers, keepLabel, keepTitle, pickProgress, releaseReady, messageProblem, moduleOf, pathsToStage, shipParams, shortHash, upgradeCommand } from "../logic.js";
import { addPicks, filterMerges, movePick, pendingOf, releaseAction, releaseBranches, releaseNotes, removePicks, taskOf } from "../release.js";
import { refusedForChanges, startPlan, whereLine, willDo } from "../tabs.js";
import { TaskPicker } from "./addons.js";
import { FileRow } from "./file-row.js";
import { TaskBadge } from "./graph-view.js";
import { Alert, Badge, Button, Field, Input, Output, Segmented, Skeleton, cn } from "./ui.js";

// ---- what the repository says, in the words of the settings
export function settings(status) {
  const s = status || {};
  return {
    messagePattern: s["config.messagePattern"] || "", forbidTrailers: s["config.forbidTrailers"] || "",
    upgradeCommand: s["config.upgradeCommand"] || "", branchPrefix: s["config.branchPrefix"] || "",
    integration: s["config.integration"] || s["config.base"] || "", release: s["config.release"] || s["config.base"] || "",
    releasePattern: s["config.releasePattern"] || "",
  };
}

// ---- the preview and the result of a run
export function PreviewBox({ runner, action }) {
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

export function ResultCard({ runner, onPullRequest, ready }) {
  const j = runner.job;
  if (!j) return null;
  const tone = j.state === "done" ? "ok" : j.state === "running" ? "neutral" : "bad";
  const check = html`<svg class="check-draw" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;
  return html`<section class="result" tabIndex="-1">
    <header>${j.state === "done" ? check : null}<strong>${j.label}</strong><${Badge} tone=${tone}>${j.state}<//><span class="grow" /><${Button} variant="ghost" size="icon" onClick=${runner.closeJob} aria-label="Dismiss">✕<//></header>
    <ol class="steps">${(j.steps || []).map(s => html`<li class=${"step-" + s.state}><code>${stepLabel(s.argv)}</code></li>`)}</ol>
    ${(j.steps || []).some(s => s.output) ? html`<details open=${j.state !== "done"}><summary class="hint">Output</summary>
      ${(j.steps || []).filter(s => s.output).map(s => html`<${Output} follow=${s.state === "running"}>${s.output}<//>`)}</details>` : null}
    ${j.state === "running" && !(j.steps || []).some(s => s.output) ? html`<p class="hint">Started: waiting for the first lines of output…</p>` : null}
    ${j.state === "stopped" ? html`<p class="hint">The repository was left mid-operation. Resolve it in the banner above.</p>` : null}
    ${j.state === "done" && (j.action === "release" || (j.action === "continue" && ready)) ? html`<${Button} variant="secondary" onClick=${onPullRequest}>Open a pull request<//>` : null}
  </section>`;
}

// ---- stopped half way
const stepMark = state => (state === "done" ? "✓" : state === "current" ? "●" : "○");
function PickProgress({ progress }) {
  const left = progress.total - progress.index;
  return html`<div class="pick-progress">
    <p class="pick-title"><strong>Commit ${progress.index} of ${progress.total}</strong> of the pick onto <code>${progress.branch}</code>${progress.push ? ", pushed when the last one is in" : ""}</p>
    <ol class="pick-steps">${progress.steps.map((s, i) => html`<li class=${"pick-" + s.state} aria-label=${s.state}><span class="pick-mark" aria-hidden="true">${stepMark(s.state)}</span>
      <span class="pick-n">${i + 1}</span><code>${shortHash(s.sha)}</code><span class="pick-subject" title=${s.subject}>${s.subject}</span><span class="hint">${s.author}${s.when ? ", " + s.when : ""}</span></li>`)}</ol>
    <p class="hint">${left ? (left === 1 ? "After this one, the last commit is picked by itself." : "After this one, the " + left + " commits that are left are picked by themselves.") : "This is the last commit."}</p>
  </div>`;
}

export function OperationBanner({ status, runner, confirm, onResolve, onHunks }) {
  if (!status || !status.operation) return null;
  const sides = onResolve ? conflictChoices(status) : null;
  const progress = pickProgress(status);
  const abort = async () => {
    if (await confirm({ title: "Abort the " + status.operation + "?", body: "The repository returns to how it was before it started.", confirmLabel: "Abort", tone: "destructive" })) runner.run("abort", {}, "Abort");
  };
  return html`<${Alert} tone="bad" title=${"Stopped: a " + status.operation + " is waiting"}>
    ${progress ? html`<${PickProgress} progress=${progress} />` : null}
    <p>Nothing was forced and nothing was pushed. Resolve the conflicts in your editor, save, then continue${sides ? ", or choose here: place by place, or one whole side of a file" : ""}.</p>
    ${sides ? html`<p class="hint">${conflictSidesLine(sides)} Keeping one side drops what the other wrote in that file.</p>` : null}
    ${status.conflict.length ? html`<ul class="files conflict-files">${status.conflict.map(f => html`<li class="conflict-row"><code>${f}</code>${sides ? html`<span class="conflict-actions">
      ${onHunks && hasMarkers(conflictCode(status, f)) ? html`<${Button} size="sm" onClick=${() => onHunks(f)} disabled=${runner.busy}>Choose place by place<//>` : null}
      <${Button} variant="outline" size="sm" title=${keepTitle(sides.ours, sides.theirs)} onClick=${() => onResolve("ours", f)} disabled=${runner.busy}>${keepLabel(sides.ours)}<//>
      <${Button} variant="outline" size="sm" title=${keepTitle(sides.theirs, sides.ours)} onClick=${() => onResolve("theirs", f)} disabled=${runner.busy}>${keepLabel(sides.theirs)}<//></span>` : null}</li>`)}</ul>` : null}
    <div class="actions"><${Button} onClick=${() => runner.run("continue", {}, "Continue")} disabled=${runner.busy}>Mark resolved and continue<//><${Button} variant="destructive" onClick=${abort} disabled=${runner.busy}>Abort<//></div>
    <p class="hint">After continuing, run Ship again (without a new message) to finish the rest.</p>
  <//>`;
}

// ---- 1. start a task
export function StartTab({ repoId, status, branches, runner, onContinue, onSwitch }) {
  const c = settings(status);
  const [name, setName] = useState("");
  // the add-ons that were enabled and add a flag to start (git shuttle start --task 4821): a field each, to start from what they know
  const [starters, setStarters] = useState([]);
  const [fromValues, setFromValues] = useState({});
  useEffect(() => {
    let alive = true;
    api("GET", "repos/" + repoId + "/addons").then(d => {
      if (!alive) return;
      setStarters((d.addons || []).filter(a => a.state === "enabled").flatMap(a => (a.flags || []).filter(f => f.startsWith("start:--")).map(f => ({ addon: a.name, flag: f.slice(8), key: a.name + ":" + f }))));
    }, () => { if (alive) setStarters([]); });
    return () => { alive = false; };
  }, [repoId]);
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
    ${starters.length ? html`<span class="section">Start from a task</span>
      <p class="lead">An enabled add-on knows the task: it proposes the name of the branch, and the branch remembers the task.</p>
      ${starters.map(s => {
        const value = (fromValues[s.key] || "").trim();
        const params = value ? { addon: { name: s.addon, flag: s.flag, value }, ...(plan.needsChoice ? { [choice]: true } : {}) } : null;
        return html`<div class="from-task">
          <${TaskPicker} repoId=${repoId} picked=${{ addon: s.addon, id: fromValues[s.key] }} onPick=${(addon, task) => { setFromValues({ ...fromValues, [s.key]: task.id }); runner.clearPreview(); }} />
          <${Field} label=${s.addon + ": " + s.flag}><${Input} value=${fromValues[s.key] || ""} placeholder="pick one above, or type the number or the link of the task" onInput=${e => { setFromValues({ ...fromValues, [s.key]: e.target.value }); runner.clearPreview(); }} /><//>
          ${params ? html`<${ActionBar} runner=${runner} action="start" params=${params} label="Create the branch from the task" />` : html`<p class="hint">Type the task to start from it.</p>`}
        </div>`;
      })}` : null}
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
  if (how === "pr" && ghMissing(status)) problems.push(GH_MISSING.title);
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
      ${how === "pr" && ghMissing(status) ? html`<${Alert} tone="warn" title=${GH_MISSING.title}>${GH_MISSING.text}<//>` : null}
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
export function ReleaseTab({ repoId, status, branches, runner, onError, onLoaded, onSettings, onCopy, onPullRequest }) {
  const c = settings(status);
  const ready = releaseReady(status);
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [editName, setEditName] = useState(false);
  const [target, setTarget] = useState("");            // a release branch that exists, to add to; "" is a new one
  const [push, setPush] = useState(true);
  const [strategy, setStrategy] = useState("");
  const [query, setQuery] = useState("");
  const [hideReleased, setHideReleased] = useState(true);
  const [taskMap, setTaskMap] = useState(null);         // which commits are for which task (the add-ons), to search and pick by task
  const [task, setTask] = useState("");

  async function load() {
    try {
      await api("POST", "repos/" + repoId + "/fetch", {});
      const found = (await api("GET", "repos/" + repoId + "/candidates")).candidates;
      const st = (await api("GET", "repos/" + repoId + "/status")).status;
      // all at once: nothing can be picked before the list is complete, and nothing picked is wiped afterwards
      setName(st["suggest.release"] || "auto");
      setPicked([]);
      api("GET", "repos/" + repoId + "/trace/map").then(setTaskMap, () => setTaskMap(null));
      setCandidates(found);
      onLoaded();
    } catch (e) { onError(e); }
  }
  useEffect(() => { load(); }, [repoId]);

  // A release that has just been made: what was picked is in the branch now. The list is read again (those commits show where they are),
  // the picks are cleared, and the tab says what comes next.
  const doneJob = runner.job && runner.job.state === "done" && runner.job.action === "release" ? runner.job : null;
  const handled = useRef(null);
  const [made, setMade] = useState(null);
  useEffect(() => {
    if (!doneJob || handled.current === doneJob.id) return;
    handled.current = doneJob.id;
    setMade(doneJob.label);
    setEditName(false);
    load();
  }, [doneJob && doneJob.id]);

  const changed = next => { setPicked(next); runner.clearPreview(); };
  const existing = releaseBranches(c.releasePattern, branchOptions(branches).map(o => o.name));
  const merges = candidates ? candidates.slice().reverse() : [];      // oldest first: that is the order they are picked in
  const visible = filterMerges(merges, query, hideReleased, taskMap, task);
  // the tasks that the unreleased commits are for, with how many: to pick by task
  const taskCounts = new Map();
  let withoutTask = 0;
  for (const m of merges) for (const cm of m.commits) {
    if (!cm.pending) continue;
    const own = taskOf(taskMap, m, cm);
    if (own) taskCounts.set(own.join(":"), (taskCounts.get(own.join(":")) || 0) + 1); else withoutTask++;
  }
  const taskInfo = key => ((taskMap && taskMap.tasks) || {})[key] || {};
  const visibleCount = visible.reduce((sum, m) => sum + m.commits.length, 0);
  const total = merges.reduce((sum, m) => sum + m.commits.length, 0);
  const plan = releaseAction({ picked, target, name, push, strategy });
  const branchName = target || name;

  if (candidates === null) return html`<div class="tab"><${Skeleton} rows=${5} height=${22} /></div>`;
  return html`<div class="tab release">
    ${ready && !made ? html`<${Alert} tone="ok" title=${"Release branch " + ready.branch + " is ready"}>
      <span>${ready.pushed ? "It is on the remote." : "It is not pushed yet: push it, then open the pull request."} The pull request goes to <code>${ready.base || c.release || "the release branch"}</code>.</span>
      <div class="actions"><${Button} size="sm" onClick=${onPullRequest}>Open the pull request<//></div><//>` : null}
    ${made ? html`<${Alert} tone="info" title=${"Done: " + made}>
      <span>The commits show “in” the release branch until its pull request is merged into <code>${c.release || "the release branch"}</code>.</span>
      <div class="actions"><${Button} size="sm" onClick=${onPullRequest}>Open the pull request<//><${Button} variant="ghost" size="sm" onClick=${() => setMade(null)}>Dismiss<//></div>
    <//>` : null}
    <ol class="how" aria-label="How a release is made">
      <li><b>1</b> Pick the commits</li><li><b>2</b> Order them</li><li><b>3</b> Name the branch</li><li><b>4</b> Create it, then open the pull request</li>
    </ol>

    <section class="stack" aria-label="Release branch">
      <span class="section">Release branch <span class="hint">cut from <code>${c.release || "the release branch"}</code></span></span>
      <${Segmented} value=${target ? "existing" : "new"} onChange=${v => { setTarget(v === "existing" ? existing[0] || "" : ""); runner.clearPreview(); }}
        options=${[{ value: "new", label: "New branch" }, { value: "existing", label: "Add to existing" + (existing.length ? " · " + existing.length : "") }]} />
      ${!target ? html`<div class="next-name">
          ${editName
            ? html`<${Input} class="mono" value=${name} onInput=${e => { setName(e.target.value); runner.clearPreview(); }} aria-label="Release branch name" />`
            : html`<code class="next-name-text" title="The next release branch, from the pattern in Settings">${name}</code>`}
          <${Button} variant="ghost" size="sm" onClick=${() => setEditName(!editName)}>${editName ? "Done" : "Edit"}<//>
        </div>
        <span class="hint">Named from the pattern in Settings${c.releasePattern ? html`: <code>${c.releasePattern}</code>` : ""}. <button type="button" class="link" onClick=${onSettings}>Change the pattern</button></span>`
        : html`<${Field} label="Release branch to add to" hint="the ones that match the pattern in Settings, newest first">
          <select class="input" value=${target} onChange=${e => { setTarget(e.target.value); runner.clearPreview(); }}>${existing.map(b => html`<option value=${b}>${b}</option>`)}</select><//>
          ${existing.length === 0 ? html`<span class="hint">No branch matches the pattern yet: make a new one.</span>` : null}`}
    </section>

    <section class="stack" aria-label="Commits to release">
      <div class="release-tools">
        <${Input} type="search" value=${query} placeholder="Search message, sha or branch" aria-label="Search the commits" onInput=${e => setQuery(e.target.value)} />
        ${taskMap ? html`<select class="input" aria-label="Task" value=${task} disabled=${!taskCounts.size} title=${taskCounts.size ? "Only the commits of one task" : "No commit is linked to a task yet: Tasks, then Branches, then Link a branch"} onChange=${e => setTask(e.target.value)}>
          <option value="">${taskCounts.size ? "All tasks" : "No task linked"}</option>
          ${[...taskCounts].map(([key, count]) => html`<option value=${key}>#${key.split(":").slice(1).join(":")} ${taskInfo(key).title || ""} (${count})</option>`)}
          ${withoutTask ? html`<option value="none">No task (${withoutTask})</option>` : null}</select>` : null}
        <label class="check" title="Commits that are in the release branch, or in a release branch that is on its way"><input type="checkbox" checked=${hideReleased} onChange=${e => setHideReleased(e.target.checked)} /> Hide released</label>
      </div>
      <div class="release-count">
        <span class="hint" aria-live="polite">${visibleCount === total ? total + " commit" + (total === 1 ? "" : "s") : visibleCount + " of " + total + " commits"} · <strong>${picked.length} picked</strong></span>
        <span class="grow" />
        <button type="button" class="link" disabled=${pendingOf(visible).length === 0} onClick=${() => changed(addPicks(picked, pendingOf(visible)))}>Select all${task && task !== "none" ? " of this task" : query || task ? " found" : " unreleased"}</button>
        <button type="button" class="link" disabled=${picked.length === 0} onClick=${() => changed([])}>Clear</button>
      </div>
      <div class="release-groups">
        ${total === 0 ? html`<p class="hint">Nothing has been merged into ${c.integration || "the integration branch"} since the last release.</p>` : null}
        ${total > 0 && visible.length === 0 ? html`<p class="hint">${query ? "No commit matches “" + query + "”." : "Everything merged so far is already released."}${hideReleased ? " " : ""}${hideReleased ? html`<button type="button" class="link" onClick=${() => setHideReleased(false)}>Show the released ones</button>` : null}</p>` : null}
        ${visible.map(m => html`<div class="group"><div class="group-head"><strong class="msg" title=${m.subject}>${m.subject}</strong><span class="grow" /><span class="hint">${(m.date || "").slice(0, 10)}</span>
            <button type="button" class="link" disabled=${m.commits.every(cm => !cm.pending)} onClick=${() => changed(addPicks(picked, m.commits))}>Select all</button></div>
          ${m.commits.map(cm => html`<label class="check pick"><input type="checkbox" disabled=${!cm.pending} checked=${picked.some(p => p.hash === cm.hash)} onChange=${e => changed(e.target.checked ? addPicks(picked, [cm]) : removePicks(picked, [cm.hash]))} />
            <code>${shortHash(cm.hash)}</code>${(own => own ? html`<${TaskBadge} id=${own[1]} title=${taskInfo(own.join(":")).title} link=${taskInfo(own.join(":")).link} />` : null)(taskOf(taskMap, m, cm))}<span class="msg" title=${cm.subject}>${cm.subject}</span>${!cm.pending ? html`<${Badge} tone=${cm.in_release ? "info" : "neutral"}>${cm.in_release ? "in " + cm.in_release : "released"}<//>` : null}</label>`)}</div>`)}
      </div>
    </section>

    ${picked.length ? html`<section class="stack" aria-label="Order on the release branch">
      <span class="section">Order on the release branch <span class="hint">cherry-picked from the top</span></span>
      ${picked.map((p, i) => html`<div class="pickrow"><span class="num">${i + 1}</span><code>${shortHash(p.hash)}</code><span class="msg" title=${p.subject}>${p.subject}</span>
        <${Button} variant="ghost" size="icon" disabled=${i === 0} onClick=${() => changed(movePick(picked, i, -1))} aria-label=${"Move " + shortHash(p.hash) + " up"}>↑<//>
        <${Button} variant="ghost" size="icon" disabled=${i === picked.length - 1} onClick=${() => changed(movePick(picked, i, 1))} aria-label=${"Move " + shortHash(p.hash) + " down"}>↓<//>
        <${Button} variant="ghost" size="icon" onClick=${() => changed(removePicks(picked, [p.hash]))} aria-label=${"Remove " + shortHash(p.hash)}>✕<//></div>`)}
      <div class="actions"><${Button} variant="outline" size="sm" onClick=${() => onCopy && onCopy(releaseNotes(branchName, picked))}>Copy release notes<//><span class="hint">Markdown for the pull request, by module.</span></div>
    </section>` : null}

    <section class="stack" aria-label="Create">
      <details class="advanced"><summary>Advanced</summary>
        <label class="check"><input type="checkbox" checked=${push} onChange=${e => { setPush(e.target.checked); runner.clearPreview(); }} /> Push the branch</label>
        <${Field} label="On conflict"><select class="input" value=${strategy} onChange=${e => { setStrategy(e.target.value); runner.clearPreview(); }}>
          <option value="">Stop and show me</option><option value="theirs">Take the picked commit</option><option value="ours">Keep the release branch</option></select><//>
      </details>
      ${plan.action
        ? html`<${ActionBar} runner=${runner} action=${plan.action} params=${plan.params} label=${plan.label} />`
        : html`<div class="actions"><${Button} disabled>${plan.label}<//><span class="hint">Pick the commits to add above.</span></div>`}
      <${PreviewBox} runner=${runner} action="release" />
    </section>
  </div>`;
}
