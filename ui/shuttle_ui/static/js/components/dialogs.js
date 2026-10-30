/* The dialogs: add a repository, change its settings. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { DEFAULT_RELEASE_PATTERN, branchOptions, inferReleasePattern, normalizePrefix, prefixOptions, releasePreview } from "../logic.js";
import { resetSkippedPreviews, skippedPreviews } from "../skip-preview.js";
import { Combobox } from "./combobox.js";
import { Button, Field, Input, Modal, Status, cn } from "./ui.js";

/* Pick a repository by walking through your home folder (the server lists folder names only, nothing outside your home). */
export function AddRepoDialog({ onAdd, onClose }) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const go = async target => {
    try {
      const d = await api("GET", "browse" + (target ? "?path=" + encodeURIComponent(target) : ""));
      setListing(d); setPath(d.path); setError("");
      try { localStorage.setItem("shuttle.lastFolder", d.path); } catch (e) { /* not remembered */ }
      return true;
    } catch (e) { setError(e.message); return false; }
  };
  // The last folder is remembered by the browser for this address, but the server behind it may be another one (another machine, WSL or
  // Windows, a folder that is gone): when it cannot be opened it is forgotten and the list starts at the home folder.
  useEffect(() => {
    let last = "";
    try { last = localStorage.getItem("shuttle.lastFolder") || ""; } catch (e) { /* none */ }
    go(last).then(ok => {
      if (ok || !last) return;
      try { localStorage.removeItem("shuttle.lastFolder"); } catch (e) { /* nothing to forget */ }
      go("");
    });
  }, []);
  // outside your home folder nothing is listed, but a path you type can still be added (the server checks that it is a repository)
  const typed = !!error && path.trim().startsWith("/");
  const canAdd = !!(listing && listing.repo) || typed;
  const submit = () => canAdd && onAdd(listing && listing.repo ? listing.path : path.trim(), name.trim());
  const tail = p => p.split("/").filter(Boolean).pop() || "/";
  return html`<${Modal} title="Add a repository" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} onClick=${submit} disabled=${!canAdd} title=${canAdd ? "" : "Open a folder that is a git repository"}>Add ${listing && listing.repo ? tail(listing.path) : typed ? tail(path.trim()) : ""}<//>`}>
    <${Field} label="Folder" hint="Type a path and press Enter, or click through the folders. Only folders inside your home folder are listed." error=${error ? error + (typed ? " The path can still be added if it is a git repository." : "") : ""}>
      <${Input} class="mono" autofocus value=${path} placeholder="/home/you/projects/my-repo" aria-invalid=${error ? "true" : undefined} onInput=${e => setPath(e.target.value)} onKeyDown=${e => e.key === "Enter" && go(path.trim())} /><//>
    ${listing ? html`<div class="folders" role="listbox" aria-label="Folders">
      ${listing.parent ? html`<button type="button" role="option" class="folder" onClick=${() => go(listing.parent)}><span aria-hidden="true">↰</span> <span>..</span> <span class="hint">up</span></button>` : null}
      ${listing.dirs.length === 0 ? html`<p class="hint pad">No folders here.</p>` : listing.dirs.map(d => html`<button type="button" role="option" class="folder" onClick=${() => go(listing.path + "/" + d.name)}><span aria-hidden="true">▸</span> <span class="mono">${d.name}</span>${d.repo ? html`<${Status}>git repository<//>` : null}</button>`)}
    </div>
    ${listing.repo ? html`<p class="hint">This folder is a git repository.</p>` : html`<p class="hint">Open a folder that is a git repository, then Add.</p>`}` : html`<p class="hint">Loading…</p>`}
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
  const [skipped, setSkipped] = useState(skippedPreviews);
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

  return html`<${Modal} title=${"Settings · " + repoName} wide onClose=${onClose} footer=${html`<${Button} variant="destructive" class="push-left" onClick=${onRemove}>Remove from list<//><${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} onClick=${save} disabled=${missing.length > 0 || !cleanName}>Save<//>`}>
    <${Field} label="Display name" hint="How this repository is listed. Two repositories may have the same name: the list then shows where each one is."><${Input} maxlength="80" value=${name} onInput=${e => setName(e.target.value)} /><//>

    ${BRANCH_FIELDS.map(([key, label, hint]) => html`<${Field} label=${label} hint=${hint}><${Combobox} label=${label} exactOnly scope="on the remote" options=${remoteOptions} value=${form[key]} onChange=${v => set(key, v)} placeholder="Type to search the branches" /><//>`)}

    <${Field} label="Task branch prefix" hint=${html`the start of the branches “Start a task” makes. Branch: <code>${prefix || "feature/"}my_task</code>`} error=${form.branchPrefix && prefix !== form.branchPrefix ? "A prefix must end with “/”: “" + prefix + "” will be saved." : ""}>
      <${Combobox} label="Task branch prefix" options=${prefixOptions(branches)} value=${form.branchPrefix} onChange=${v => set("branchPrefix", v)} placeholder="feature/" />
    <//>

    <${Field} label="Release branch name" hint="the name “Release” proposes. {yymmdd} 261021 · {date} 20261021 · {n} the first free number from 0" error=${preview.error || ""}>
      <${Input} class="mono" value=${form.releasePattern} placeholder=${DEFAULT_RELEASE_PATTERN} aria-invalid=${preview.error ? "true" : undefined} onInput=${e => set("releasePattern", e.target.value)} />
      <div class="chips">
        ${["{yymmdd}", "{date}", "{n}"].map(t => html`<button type="button" class="chip" onClick=${() => set("releasePattern", form.releasePattern + t)}>${t}</button>`)}
      </div>
      <div class="chips">
        ${presets.map(p => html`<button type="button" class=${cn("chip", "chip-preset", p === form.releasePattern && "on")} onClick=${() => set("releasePattern", p)} title="Use this pattern">${p}${p === detected ? html` <em>from your branches</em>` : ""}</button>`)}
      </div>
      ${preview.error ? null : html`<span class="field-hint">Next release branch: <code>${preview.name}</code></span>`}
    <//>

    ${RULE_FIELDS.map(([key, label, hint]) => html`<${Field} label=${label} hint=${hint}><${Input} class="mono" value=${form[key]} onInput=${e => set(key, e.target.value)} /><//>`)}

    ${skipped.length ? html`<${Field} label="Previews you turned off" hint="These actions run at once, without showing what will run. Undo takes them back. The risky ones (reset, discard, drop, force push, delete) always ask.">
      <div class="chips">${skipped.map(a => html`<span class="chip">${a}</span>`)}</div>
      <${Button} variant="outline" size="sm" onClick=${() => { resetSkippedPreviews(); setSkipped([]); }}>Show the previews again<//>
    <//>` : null}
  <//>`;
}
