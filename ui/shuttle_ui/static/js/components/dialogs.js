/* The dialogs: add a repository, change its settings, read the history. */
import { html, useState } from "../../vendor/preact-htm.js";
import { Badge, Button, Field, Input, Modal } from "./ui.js";

export function AddRepoDialog({ onAdd, onClose }) {
  const [path, setPath] = useState("");
  const submit = () => path.trim() && onAdd(path.trim());
  return html`<${Modal} title="Add a repository" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} onClick=${submit} disabled=${!path.trim()}>Add<//>`}>
    <${Field} label="Absolute path of a git repository" hint="Only repositories added here can be acted on.">
      <${Input} class="mono" autofocus value=${path} placeholder="/home/you/projects/my-repo" onInput=${e => setPath(e.target.value)} onKeyDown=${e => e.key === "Enter" && submit()} /><//>
  <//>`;
}

const FIELDS = [
  ["integration", "Integration branch", "where task branches are merged, e.g. staging"],
  ["release", "Release branch", "releases start from here, e.g. main"],
  ["branchPrefix", "Task branch prefix", "e.g. feature/"],
  ["releasePattern", "Release branch name", "{date} {yymmdd} {n}"],
  ["messagePattern", "Commit message pattern", "a regex, e.g. ^\\[[A-Z]+\\] [^:]+: .+"],
  ["forbidTrailers", "Forbidden trailers", "e.g. Co-Authored-By"],
  ["upgradeCommand", "Test command", "shown to be copied, never run; {modules} = changed modules"],
];

export function SettingsDialog({ status, repoName, onSave, onRemove, onClose }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, status["config." + k] || ""])));
  return html`<${Modal} title=${"Settings · " + repoName} onClose=${onClose} footer=${html`<${Button} variant="destructive" class="push-left" onClick=${onRemove}>Remove from list<//><${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} onClick=${() => onSave(form)}>Save<//>`}>
    ${FIELDS.map(([key, label, hint]) => html`<${Field} label=${label} hint=${hint}><${Input} class="mono" value=${form[key]} onInput=${e => setForm({ ...form, [key]: e.target.value })} /><//>`)}
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
