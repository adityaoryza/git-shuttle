/* The action panel: Start a task, Ship it, Release it. Each ends in one button: Preview, then Run. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { branchFromName, groupByModule, messageProblem, pathsToStage, shipParams, shortHash, upgradeCommand } from "../logic.js";
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
const stepLabel = argv => (argv[0] === "commit" ? "commit " + JSON.stringify(argv[2]) : "git shuttle " + argv.slice(0, 2).join(" "));

export function ResultCard({ runner, onPullRequest }) {
  const j = runner.job;
  if (!j) return null;
  const tone = j.state === "done" ? "ok" : j.state === "running" ? "neutral" : "bad";
  return html`<section class="result">
    <header><strong>${j.label}</strong><${Badge} tone=${tone}>${j.state}<//><span class="grow" /><${Button} variant="ghost" size="icon" onClick=${runner.closeJob} aria-label="Dismiss">✕<//></header>
    <ol class="steps">${(j.steps || []).map(s => html`<li class=${"step-" + s.state}><code>${stepLabel(s.argv)}</code></li>`)}</ol>
    ${(j.steps || []).some(s => s.output) ? html`<details open=${j.state !== "done"}><summary class="hint">Output</summary>
      ${(j.steps || []).filter(s => s.output).map(s => html`<${Output}>${s.output}<//>`)}</details>` : null}
    ${j.state === "stopped" ? html`<p class="hint">The repository was left mid-operation. Resolve it in the banner above.</p>` : null}
    ${j.state === "done" && j.action === "release" ? html`<${Button} variant="secondary" onClick=${onPullRequest}>Open a pull request<//>` : null}
  </section>`;
}

// ---- stopped half way
export function OperationBanner({ status, runner }) {
  if (!status || !status.operation) return null;
  const abort = () => { if (window.confirm("Abort the " + status.operation + "? The repository returns to how it was before it started.")) runner.run("abort", {}, "Abort"); };
  return html`<${Alert} tone="bad" title=${"Stopped: a " + status.operation + " is waiting"}>
    <p>Nothing was forced and nothing was pushed. Resolve the conflicts in your editor, save, then continue.</p>
    ${status.conflict.length ? html`<ul class="files">${status.conflict.map(f => html`<li><code>${f}</code></li>`)}</ul>` : null}
    <div class="actions"><${Button} onClick=${() => runner.run("continue", {}, "Continue")} disabled=${runner.busy}>Mark resolved and continue<//><${Button} variant="destructive" onClick=${abort} disabled=${runner.busy}>Abort<//></div>
    <p class="hint">After continuing, run Ship again (without a new message) to finish the rest.</p>
  <//>`;
}

// ---- 1. start a task
export function StartTab({ status, runner }) {
  const c = settings(status);
  const [name, setName] = useState("");
  const prefix = c.branchPrefix || "feature/";
  const branch = branchFromName(name, prefix);
  const params = { name };
  return html`<div class="tab">
    <p class="lead">One branch per task, created from <code>${c.integration || "the integration branch"}</code>.</p>
    <${Field} label="Task name"><${Input} value=${name} placeholder="e.g. keep manual order date" onInput=${e => { setName(e.target.value); runner.clearPreview(); }} /><//>
    <p class="hint">Branch: <code>${branch || "—"}</code></p>
    <${ActionBar} runner=${runner} action="start" params=${params} label="Create branch" disabled=${!branch} />
    <${PreviewBox} runner=${runner} action="start" />
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

function GroupBox({ g, index, count, cfg, update, move }) {
  const problem = g.include ? messageProblem(g.message, cfg) : "";
  const untouched = g.message === g.draft;   // do not scold a message that is still the suggested start
  return html`<div class=${cn("group", !g.include && "group-off")}>
    <div class="group-head">
      <input type="checkbox" checked=${g.include} onChange=${e => update(index, { include: e.target.checked })} aria-label=${"Include " + g.module} />
      <strong>${g.module}</strong><span class="hint">${g.files.length} ${g.files.length === 1 ? "file" : "files"}</span><span class="grow" />
      <${Button} variant="ghost" size="icon" disabled=${index === 0} onClick=${() => move(index, -1)} aria-label="Move up">↑<//>
      <${Button} variant="ghost" size="icon" disabled=${index === count - 1} onClick=${() => move(index, 1)} aria-label="Move down">↓<//>
    </div>
    <${Input} class=${cn("mono", g.include && !untouched && (problem ? "invalid" : "valid"))} value=${g.message} disabled=${!g.include} onInput=${e => update(index, { message: e.target.value })} />
    ${g.include && problem && !untouched ? html`<span class="field-hint bad">${problem}</span>` : html`<span class="field-hint">${untouched && g.include ? "Finish the message: [TAG] module: what changed" : ""}</span>`}
  </div>`;
}

export function ShipTab({ status, runner, groups, setGroups, tested, setTested }) {
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
  const cmd = upgradeCommand(c.upgradeCommand, groups.filter(g => g.module !== "(root)"));
  const into = c.integration || "the integration branch";

  return html`<div class="tab">
    ${groups.length ? html`<div class="stack">
      <span class="section">Commits <span class="hint">one per module — order them by dependency</span></span>
      ${groups.map((g, i) => html`<${GroupBox} g=${g} index=${i} count=${groups.length} cfg=${c} update=${update} move=${move} />`)}
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
