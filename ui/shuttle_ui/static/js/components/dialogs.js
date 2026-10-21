/* The dialogs: add a repository, change its settings, read the history. */
import { html, useState } from "../../vendor/preact-htm.js";
import { DEFAULT_RELEASE_PATTERN, branchOptions, inferReleasePattern, normalizePrefix, prefixOptions, releasePreview } from "../logic.js";
import { Combobox } from "./combobox.js";
import { Badge, Button, Field, Input, Modal, cn } from "./ui.js";

export function AddRepoDialog({ onAdd, onClose }) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const submit = () => path.trim() && onAdd(path.trim(), name.trim());
  return html`<${Modal} title="Add a repository" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} onClick=${submit} disabled=${!path.trim()}>Add<//>`}>
    <${Field} label="Absolute path of a git repository" hint="Only repositories added here can be acted on.">
      <${Input} class="mono" autofocus value=${path} placeholder="/home/you/projects/my-repo" onInput=${e => setPath(e.target.value)} onKeyDown=${e => e.key === "Enter" && submit()} /><//>
    <${Field} label="Display name (optional)" hint="Shown in the list. The folder name is used when empty; you can rename it later in Settings."><${Input} maxlength="80" value=${name} onInput=${e => setName(e.target.value)} onKeyDown=${e => e.key === "Enter" && submit()} /><//>
  <//>`;
}

const BRANCH_FIELDS = [
  ["base", "Base branch", "the main line of the project, e.g. main or 19.0; used when the other two are not set"],
  ["integration", "Integration branch", "where task branches are merged, e.g. staging"],
  ["release", "Release branch", "releases start from here"],
];
const RULE_FIELDS = [
  ["messagePattern", "Commit message pattern", "a regex, e.g. ^\\[[A-Z]+\\] [^:]+: .+"],
  ["forbidTrailers", "Forbidden trailers", "e.g. Co-Authored-By"],
  ["upgradeCommand", "Test command", "shown to be copied, never run; {modules} = changed modules"],
];
const KEYS = ["base", "integration", "release", "branchPrefix", "releasePattern", ...RULE_FIELDS.map(f => f[0])];

export function SettingsDialog({ status, branches, repoName, onSave, onRemove, onClose }) {
  const initial = () => Object.fromEntries(KEYS.map(k => [k, status["config." + k] || ""]));
  const [form, setForm] = useState(initial);
  const [name, setName] = useState(repoName);
  const set = (key, value) => setForm({ ...form, [key]: value });
  const options = branchOptions(branches);
  const names = options.map(o => o.name);
  // base, integration and release are read from the remote: a branch that only exists here cannot be used
  const remoteOptions = options.filter(o => o.where !== "local");
  const missing = branches ? BRANCH_FIELDS.filter(([key]) => form[key] && !remoteOptions.some(o => o.name === form[key])) : [];
  const detected = inferReleasePattern(names);
  const preview = releasePreview(form.releasePattern, names);
  const prefix = normalizePrefix(form.branchPrefix);
  const base = form.base || form.integration || "";
  const presets = [...new Set([detected, base && base + "-release/{yymmdd}-v1.{n}", DEFAULT_RELEASE_PATTERN].filter(Boolean))];
  const start = initial();
  const settingsChanged = KEYS.some(k => (k === "branchPrefix" ? prefix : form[k]) !== (k === "branchPrefix" ? normalizePrefix(start[k]) : start[k]));
  const cleanName = name.trim();
  const nameChanged = cleanName !== repoName;
  const save = () => {
    if (missing.length || !cleanName) return;
    if (!nameChanged && !settingsChanged) return onClose();
    onSave({ name: cleanName, nameChanged, settings: { ...form, branchPrefix: prefix }, settingsChanged });
  };

  return html`<${Modal} title=${"Settings · " + repoName} onClose=${onClose} footer=${html`<${Button} variant="destructive" class="push-left" onClick=${onRemove}>Remove from list<//><${Button} variant="ghost" onClick=${onClose}>Cancel<//>${missing.length ? html`<span class="field-hint warn grow" role="alert">Pick an existing branch of the remote for: ${missing.map(f => f[1]).join(", ")}</span>` : null}<${Button} onClick=${save} disabled=${missing.length > 0 || !cleanName}>Save<//>`}>
    <${Field} label="Display name" hint="How this repository is listed. Two repositories may have the same name: the list then shows where each one is."><${Input} maxlength="80" value=${name} onInput=${e => setName(e.target.value)} /><//>

    ${BRANCH_FIELDS.map(([key, label, hint]) => html`<${Field} label=${label} hint=${hint}><${Combobox} label=${label} exactOnly scope="on the remote" options=${remoteOptions} value=${form[key]} onChange=${v => set(key, v)} placeholder="Type to search the branches" /><//>`)}

    <${Field} label="Task branch prefix" hint=${html`the start of the branches “Start a task” makes. Branch: <code>${prefix || "feature/"}my_task</code>`}>
      <${Combobox} label="Task branch prefix" options=${prefixOptions(branches)} value=${form.branchPrefix} onChange=${v => set("branchPrefix", v)} placeholder="feature/" />
      ${form.branchPrefix && prefix !== form.branchPrefix ? html`<span class="field-hint warn">A prefix must end with “/”: “${prefix}” will be saved.</span>` : null}
    <//>

    <${Field} label="Release branch name" hint="the name “Release” proposes. {yymmdd} 261021 · {date} 20261021 · {n} the first free number from 0">
      <${Input} class="mono" value=${form.releasePattern} placeholder=${DEFAULT_RELEASE_PATTERN} onInput=${e => set("releasePattern", e.target.value)} />
      <div class="chips">
        ${["{yymmdd}", "{date}", "{n}"].map(t => html`<button type="button" class="chip" onClick=${() => set("releasePattern", form.releasePattern + t)}>${t}</button>`)}
      </div>
      <div class="chips">
        ${presets.map(p => html`<button type="button" class=${cn("chip", "chip-preset", p === form.releasePattern && "on")} onClick=${() => set("releasePattern", p)} title="Use this pattern">${p}${p === detected ? html` <em>from your branches</em>` : ""}</button>`)}
      </div>
      ${preview.error ? html`<span class="field-hint warn">${preview.error}</span>` : html`<span class="field-hint ok">Next release branch: <code>${preview.name}</code></span>`}
    <//>

    ${RULE_FIELDS.map(([key, label, hint]) => html`<${Field} label=${label} hint=${hint}><${Input} class="mono" value=${form[key]} onInput=${e => set(key, e.target.value)} /><//>`)}
  <//>`;
}

export function HistoryDialog({ history, onClose }) {
  return html`<${Modal} title="History" wide onClose=${onClose}>
    ${history.length === 0 ? html`<p class="hint">Nothing has been run yet. Only actions run from this UI are listed, on this machine.</p>` : html`<table class="table">
      <thead><tr><th>Time</th><th>Repository</th><th>Action</th><th>Result</th></tr></thead>
      <tbody>${history.map(e => html`<tr><td class="mono">${(e.time || "").replace("T", " ")}</td><td>${e.repo}</td><td>${e.action}</td>
        <td><${Badge} tone=${e.state === "done" ? "ok" : "bad"}>${e.state}<//></td></tr>`)}</tbody></table>`}
  <//>`;
}
