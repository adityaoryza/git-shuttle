/* Add-ons: the cards that the enabled ones show for the branch, and the dialog that lists them (docs/addons.md).
 * What an add-on says was checked by the command (a size, a safe alphabet, http or https for a link); it is shown as text, never as HTML. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { ExternalLink } from "./links.js";
import { Alert, Badge, Button, Field, Input, Modal, Segmented, Skeleton } from "./ui.js";
import { Combobox } from "./combobox.js";

const webAddress = link => (typeof link === "string" && /^https?:\/\//.test(link) ? link : "");

// version: anything that should make the cards be read again (another tab, a job that ended: an add-on may just have been enabled)
export function AddonCards({ repoId, branch, version }) {
  const [groups, setGroups] = useState([]);
  const [problems, setProblems] = useState([]);
  useEffect(() => {
    let alive = true;
    api("GET", "repos/" + repoId + "/addons/cards").then(d => { if (alive) { setGroups(d.cards || []); setProblems(d.problems || []); } }, () => { if (alive) { setGroups([]); setProblems([]); } });
    return () => { alive = false; };
  }, [repoId, branch, version]);
  const cards = groups.flatMap(g => (g.cards || []).map(c => ({ ...c, addon: g.addon })));
  if (!cards.length && !problems.length) return null;
  return html`<section class="addon-cards" aria-label="From add-ons">
    ${problems.map(p => html`<p class="hint addon-problem">The add-on <strong>${p.addon}</strong> shows nothing: ${p.problem}</p>`)}
    ${cards.map(card => html`<article class="addon-card">
    <header><strong>${card.title}</strong>${card.subtitle ? html`<${Badge}>${card.subtitle}<//>` : null}</header>
    ${webAddress(card.link) ? html`<${ExternalLink} href=${card.link} class="addon-link">${card.link.replace(/^https?:\/\//, "")}<//>` : null}
    ${(card.fields || []).length ? html`<dl class="addon-fields">${card.fields.map(f => html`<dt>${f.label}</dt><dd>${f.value}</dd>`)}</dl>` : null}
    ${card.text ? html`<p class="addon-text">${card.text}</p>` : null}
    <footer class="hint">from the add-on ${card.addon}</footer>
  </article>`)}
  </section>`;
}

const TONE = { enabled: "ok", changed: "warn", found: "neutral", missing: "bad" };
const SAY = {
  enabled: "enabled",
  changed: "changed since it was enabled: enable it again to use it",
  found: "found, not enabled",
  missing: "not found",
};

export function AddonsDialog({ repoId, onRun, onSetup, onClose, notify }) {
  const [list, setList] = useState(null);
  const [available, setAvailable] = useState(null);
  useEffect(() => {
    api("GET", "repos/" + repoId + "/addons").then(d => setList(d.addons), e => { setList([]); notify({ variant: "error", title: "Cannot list the add-ons", detail: e.message }); });
    api("GET", "repos/" + repoId + "/addons/available").then(d => setAvailable(d.available), () => setAvailable([]));
  }, []);
  return html`<${Modal} title="Add-ons" wide onClose=${onClose}>
    <p class="hint">An add-on is a program named <code>git-shuttle-NAME</code> that tells git-shuttle more (the task of a branch, the text of a pull request). None does anything until you enable it, and enabling pins the program: if it changes, it has to be enabled again.</p>
    <h3 class="sub">Installed</h3>
    ${list === null ? html`<p class="hint">Loading…</p>` : list.length === 0 ? html`<p class="hint">None yet: install one below.</p>` : html`<ul class="stash-list addon-rows">${list.map(a => html`<li>
      <strong class="mono">${a.name}</strong>${a.version ? html`<span class="hint">${a.version}</span>` : null}<${Badge} tone=${TONE[a.state] || "neutral"}>${a.state}<//>
      <span class="msg hint" title=${a.path}>${SAY[a.state] || ""}</span>
      <span class="row-actions">${a.state === "enabled" && (a.hooks || []).includes("report") ? html`<${Button} size="sm" variant="ghost" title="After a pull request, the add-on adds its link and the commits to the Customer report of the task: it shows the text first, and it only adds" onClick=${() => onRun("addon-report", { name: a.name, on: !a.report }, "Customer report of " + a.name + ": " + (a.report ? "off" : "on"))}>Customer report: ${a.report ? "on" : "off"}<//>` : null}${a.state === "enabled" && (a.hooks || []).includes("setup") ? html`<${Button} size="sm" variant="secondary" onClick=${() => onSetup(a.name)}>Set up<//>` : null}${a.state === "enabled"
        ? html`<${Button} size="sm" variant="ghost" onClick=${() => onRun("addon-disable", { name: a.name }, "Disable the add-on " + a.name)}>Disable<//>`
        : html`<${Button} size="sm" variant="ghost" onClick=${() => onRun("addon-enable", { name: a.name }, "Enable the add-on " + a.name)}>${a.state === "changed" ? "Enable again" : "Enable"}<//>`}</span></li>`)}</ul>`}
    <h3 class="sub">Available</h3>
    <p class="hint">From the list that ships with git-shuttle. Installing downloads the release of its repository over https, checks its checksum and unpacks it in your add-on folder; nothing runs until you enable it. The preview shows the address and the folder.</p>
    ${available === null ? html`<p class="hint">Loading…</p>` : available.length === 0 ? html`<p class="hint">No add-on in the list.</p>` : html`<ul class="stash-list addon-rows">${available.map(a => html`<li>
      <strong>${a.title || a.name}</strong><span class="hint mono">${a.name}</span>${a.version ? html`<${Badge} tone="ok">installed ${a.version}<//>` : html`<${Badge}>not installed<//>`}
      <span class="msg hint" title=${a.description}>${a.description}</span>
      <span class="row-actions">${a.version
        ? html`<${Button} size="sm" variant="ghost" onClick=${() => onRun("addon-install", { name: a.name }, "Update the add-on " + a.name)}>Update<//><${Button} size="sm" variant="ghost" onClick=${() => onRun("addon-uninstall", { name: a.name }, "Remove the add-on " + a.name)}>Remove<//>`
        : html`<${Button} size="sm" variant="secondary" onClick=${() => onRun("addon-install", { name: a.name }, "Install the add-on " + a.name)}>Install<//>`}</span></li>`)}</ul>`}
  <//>`;
}

// what an add-on needs from you (a login, a key). What is typed goes to the add-on and is not kept here: a secret is never shown back.
export function AddonSetupDialog({ repoId, name, onClose, notify }) {
  const [form, setForm] = useState(null);
  const [typed, setTyped] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const path = "repos/" + repoId + "/addons/" + name + "/setup";
  const load = () => api("GET", path).then(d => { setForm(d); setTyped({}); }, e => { setForm({ fields: [], ready: false, note: "" }); setResult({ ok: false, message: e.message }); });
  useEffect(() => { load(); }, []);
  const fields = (form && form.fields) || [];
  const missing = fields.filter(f => f.required && !(typed[f.key] || "").trim() && !(f.kind === "secret" ? f.set : (f.value || "").trim()));
  const save = async () => {
    setBusy(true); setResult(null);
    const values = {};
    for (const f of fields) if (typed[f.key] !== undefined && typed[f.key] !== "") values[f.key] = typed[f.key];
    try {
      const d = await api("POST", path, { values });
      setTyped(t => Object.fromEntries(fields.filter(f => f.kind !== "secret").map(f => [f.key, t[f.key]]).filter(([, v]) => v !== undefined)));   // a key does not stay in the page
      setResult(d);
      if (d.ok) { notify({ variant: "success", title: "Add-on " + name + " is set up", detail: d.message }); await load(); }
    } catch (e) { setResult({ ok: false, message: e.message }); }
    setTyped(t => Object.fromEntries(fields.filter(f => f.kind !== "secret").map(f => [f.key, t[f.key]]).filter(([, v]) => v !== undefined)));
    setBusy(false);
  };
  return html`<${Modal} title=${"Set up " + name} wide onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Close<//><${Button} onClick=${save} busy=${busy} disabled=${busy || !form || missing.length > 0 || !Object.values(typed).some(v => v)} title=${missing.length ? "Fill in: " + missing.map(f => f.label).join(", ") : ""}>Save and test<//>`}>
    <p class="hint">What you type goes to the add-on to keep, the way it does for its own command. git-shuttle does not store, log or show it again: a key shows only as <em>set</em>. Leave a field empty to keep what is saved.</p>
    ${form === null ? html`<p class="hint">Loading…</p>` : html`
      ${form.ready ? html`<${Badge} tone="ok">ready<//>` : html`<${Badge} tone="warn">not ready yet<//>`}${form.note ? html` <span class="hint">${form.note}</span>` : null}
      ${fields.map(f => html`<${Field} label=${f.label + (f.required ? " *" : "")} hint=${f.help}>
        <${Input} type=${f.kind === "secret" ? "password" : "text"} class=${f.kind === "path" || f.kind === "url" ? "mono" : ""} autocomplete=${f.kind === "secret" ? "new-password" : "off"} spellcheck="false"
          value=${typed[f.key] !== undefined ? typed[f.key] : f.kind === "secret" ? "" : f.value}
          placeholder=${f.kind === "secret" ? (f.set ? "set: type to replace it" : "not set") : ""}
          onInput=${e => setTyped({ ...typed, [f.key]: e.target.value })} />
      <//>`)}
      ${result ? html`<${Alert} tone=${result.ok ? "info" : "bad"}><span>${result.message}</span><//>` : null}`}
  <//>`;
}

// the tasks that the enabled add-ons list; pick one to start it (onPick(addon, task))
const fieldOf = (task, label) => ((task.fields || []).find(f => f.label === label) || {}).value || "";
const SORTS = {
  newest: ["Newest first", (a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })],
  oldest: ["Oldest first", (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })],
  title: ["Title A to Z", (a, b) => a.title.localeCompare(b.title)],
  stage: ["Stage", (a, b) => (a.subtitle || "").localeCompare(b.subtitle || "") || b.id.localeCompare(a.id, undefined, { numeric: true })],
  deadline: ["Deadline", (a, b) => (fieldOf(a, "Deadline") || "9").localeCompare(fieldOf(b, "Deadline") || "9")],
};
const NO_FILTER = { text: "", stage: "", project: "", fetched: "", sort: "newest" };

export function TaskPicker({ repoId, version, onPick, picked }) {
  const [state, setState] = useState({ loading: true, groups: [], problems: [] });
  const [f, setF] = useState(NO_FILTER);
  const [closed, setClosed] = useState(false);
  const load = () => {
    setState(s => ({ ...s, loading: true }));
    api("GET", "repos/" + repoId + "/addons/tasks" + (closed ? "?all=1" : "")).then(d => setState({ loading: false, groups: d.tasks || [], problems: d.problems || [] }), e => setState({ loading: false, groups: [], problems: [{ addon: "?", problem: e.message }] }));
  };
  useEffect(load, [repoId, version, closed]);
  const all = state.groups.flatMap(g => (g.tasks || []).map(t => ({ ...t, addon: g.addon })));
  const options = key => [...new Set(all.map(key).filter(Boolean))].sort();
  // the three newest (the highest numbers) are marked, whatever the filters and the sort
  const newest = new Set([...all].sort(SORTS.newest[1]).slice(0, 3).map(t => t.addon + ":" + t.id));
  const needle = f.text.trim().toLowerCase();
  const shown = all.filter(t => (!needle || [t.id, t.title, t.subtitle].concat((t.fields || []).map(x => x.value)).join(" ").toLowerCase().includes(needle))
    && (!f.stage || t.subtitle === f.stage) && (!f.project || fieldOf(t, "Project") === f.project) && (!f.fetched || fieldOf(t, "Fetched") === f.fetched))
    .sort(SORTS[f.sort][1]);
  const set = patch => setF({ ...f, ...patch });
  const active = f.text || f.stage || f.project || f.fetched || f.sort !== "newest";
  const pick = (label, key, values, name) => html`<select class="input" aria-label=${label} value=${f[key]} onChange=${e => set({ [key]: e.target.value })}><option value="">${label}</option>${values.map(v => html`<option value=${v}>${name ? name(v) : v}</option>`)}</select>`;
  return html`<div class="task-picker">
    <div class="task-bar"><${Input} value=${f.text} placeholder="Search my tasks (number, title, project)" onInput=${e => set({ text: e.target.value })} /><${Button} size="sm" variant="ghost" onClick=${load} busy=${state.loading}>Refresh<//></div>
    <div class="task-filters">
      ${pick("All stages", "stage", options(t => t.subtitle))}
      ${pick("All projects", "project", options(t => fieldOf(t, "Project")))}
      ${pick("Fetched or not", "fetched", ["yes", "no"], v => (v === "yes" ? "Fetched" : "Not fetched"))}
      <select class="input" aria-label="Sort" value=${f.sort} onChange=${e => set({ sort: e.target.value })}>${Object.entries(SORTS).map(([k, [label]]) => html`<option value=${k}>${label}</option>`)}</select>
    </div>
    <div class="task-bar">
      <label class="check"><input type="checkbox" checked=${closed} onChange=${e => setClosed(e.target.checked)} /><span>Include done and closed</span></label>
      <span class="hint grow">${state.loading ? "Loading…" : shown.length + " of " + all.length + " tasks"}</span>
      ${active ? html`<${Button} size="sm" variant="ghost" onClick=${() => setF(NO_FILTER)}>Clear filters<//>` : null}
    </div>
    ${state.problems.map(p => html`<p class="hint addon-problem">The add-on <strong>${p.addon}</strong> lists no task: ${p.problem}</p>`)}
    ${state.groups.filter(g => g.note).map(g => html`<p class="hint">${g.note}</p>`)}
    ${shown.length ? html`<ul class="task-list">${shown.map(t => html`<li class=${(picked && picked.id === t.id && picked.addon === t.addon ? "picked " : "") + (newest.has(t.addon + ":" + t.id) ? "is-new" : "")}>
      <button type="button" class="task-row" aria-pressed=${!!(picked && picked.id === t.id && picked.addon === t.addon)} onClick=${() => onPick(t.addon, t)}>
        <span class="task-check" aria-hidden="true">${picked && picked.id === t.id && picked.addon === t.addon ? "✓" : ""}</span><span class="mono">${t.id}</span><strong>${t.title}</strong>${newest.has(t.addon + ":" + t.id) ? html`<${Badge} tone="info">new<//>` : null}${t.subtitle ? html`<${Badge}>${t.subtitle}<//>` : null}
        ${(t.fields || []).length ? html`<span class="hint">${t.fields.map(x => x.label + ": " + x.value).join(" · ")}</span>` : null}
      </button></li>`)}</ul>` : null}
    ${!state.loading && !state.problems.length && !shown.length ? html`<p class="hint">${all.length ? "No task matches the filters." : "No task listed."}</p>` : null}
  </div>`;
}

const EVENT_SAY = { bind: "Linked to the task", start: "Started", commit: "Commit", push: "Pushed", pr: "Pull request", merge: "Merged", release: "Released", deploy: "Deployed" };
const eventText = e => [e.branch && "branch " + e.branch, e.sha && e.sha.slice(0, 10), e.title || e.subject, e.url, e.target && "to " + e.target, e.tag && "tag " + e.tag, e.base && "into " + e.base, e.into && "into " + e.into, e.release_branch && "onto " + e.release_branch, e.linked && "added afterwards, with its real date"].filter(Boolean).join(" · ");

// every step that git-shuttle took for the tasks, in order: start, commit, push, pull request, merge, release, deploy
// a date of the trace (UTC, with a Z) in the time zone of this browser
const localTime = iso => { const d = new Date(iso); return isNaN(d) ? String(iso || "") : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
const LAST_SAY = { start: "started", commit: "committed", push: "pushed", pr: "pull request", merge: "merged", release: "released", deploy: "deployed", bind: "linked" };

function Timeline({ events }) {
  const [all, setAll] = useState(false);
  const commits = events.filter(e => e.type === "commit");
  const hidden = !all && commits.length > 6 ? new Set(commits.slice(2, -2)) : new Set();     // a long list of commits is folded: the first two and the last two
  const rows = [];
  events.forEach(e => {
    if (hidden.has(e)) { if (!rows.length || rows[rows.length - 1].fold === undefined) rows.push({ fold: 0 }); rows[rows.length - 1].fold++; } else rows.push({ e });
  });
  return html`<ol class="timeline">${rows.map(r => (r.fold !== undefined
    ? html`<li class="ev-fold"><button type="button" class="link" onClick=${() => setAll(true)}>Show ${r.fold} more commits</button></li>`
    : html`<li class=${"ev-" + r.e.type}>
      <strong>${EVENT_SAY[r.e.type] || r.e.type}</strong><span class="hint">${localTime(r.e.time)}</span>
      <span class="msg">${eventText(r.e)}</span>
      ${webAddress(r.e.url) ? html`<${ExternalLink} href=${r.e.url} class="addon-link">${r.e.url.replace(/^https?:\/\//, "")}<//>` : null}
      ${r.e.derived ? html`<span class="hint">${r.e.derived}</span>` : null}
      ${r.e.details ? html`<dl class="addon-fields">${Object.entries(r.e.details).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : null}
    </li>`))}</ol>`;
}

// every step that git-shuttle took for the tasks, in order: start, commit, push, pull request, merge, release, deploy.
// A branch that had work before can be linked to a task: its past (commits, pull request, merge) is written with the dates it had.
export function TasksDialog({ repoId, branches, current, onRun, onClose, notify }) {
  const [tab, setTab] = useState("tasks");
  const [tasks, setTasks] = useState(null);
  const [open, setOpen] = useState(null);          // "addon:id" of the task whose timeline is shown
  const [trace, setTrace] = useState(null);
  const [linked, setLinked] = useState(null);
  const [linking, setLinking] = useState(false);
  const [branch, setBranch] = useState(current || "");
  const [pick, setPick] = useState(null);
  const [typed, setTyped] = useState("");
  const local = ((branches && branches.local) || []).map(b => b.name);
  const names = current && local.includes(current) ? [current, ...local.filter(n => n !== current)] : local;
  useEffect(() => {
    api("GET", "repos/" + repoId + "/trace/tasks").then(d => setTasks(d.tasks || []), e => { setTasks([]); notify({ variant: "error", title: "Cannot read the tasks", detail: e.message }); });
    api("GET", "repos/" + repoId + "/trace/map").then(d => setLinked(Object.entries(d.branches || {}).map(([name, b]) => ({ name, ...b }))), () => setLinked([]));
  }, []);
  const toggle = t => {
    const key = t.addon + ":" + t.id;
    if (open === key) { setOpen(null); return; }
    setOpen(key); setTrace(null);
    api("POST", "repos/" + repoId + "/trace/show", { addon: t.addon, task: t.id }).then(setTrace, e => notify({ variant: "error", title: "Cannot read the trace", detail: e.message }));
  };
  const task = typed.trim() || (pick && pick.task.id) || "";
  const addon = typed.trim() ? "" : pick ? pick.addon : "";
  const goLink = () => { setTab("branches"); setLinking(true); };
  return html`<${Modal} title="Tasks" wide onClose=${onClose} initialFocus=".segmented button.on">
    <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: "tasks", label: "Tasks" + (tasks ? " (" + tasks.length + ")" : "") }, { value: "branches", label: "Branches" + (linked ? " (" + linked.length + ")" : "") }]} />
    ${tab === "tasks" ? html`
      <p class="hint">What happened to each task you started from an add-on, from the first commit to the deploy. Click a task to see it. Times are in your time zone; nothing leaves this repository.</p>
      ${tasks === null ? html`<${Skeleton} rows=${3} />` : tasks.length === 0 ? html`<div class="empty-note"><strong>No task yet</strong><span class="hint">Start one from the Start tab, or link a branch that already has work.</span></div>` : html`<ul class="task-accordion">${tasks.map(t => {
        const key = t.addon + ":" + t.id, isOpen = open === key;
        return html`<li class=${isOpen ? "open" : ""}>
          <button type="button" class="task-head" aria-expanded=${isOpen} onClick=${() => toggle(t)}>
            <span class="chev" aria-hidden="true">${isOpen ? "▾" : "▸"}</span><span class="mono">${t.id}</span><strong class="msg">${t.title || "(no title)"}</strong>
            <span class="hint">${LAST_SAY[t.last_type] || t.last_type} · ${localTime(t.last)}</span><span class="row-actions">Timeline</span>
          </button>
          ${t.branches.length ? html`<div class="task-branches">${t.branches.map(b => html`<span class="ref" title=${b}>${b}</span>`)}</div>` : null}
          ${isOpen ? html`<div class="task-body">
            ${webAddress(t.link) ? html`<${ExternalLink} href=${t.link} class="addon-link">${t.link.replace(/^https?:\/\//, "")}<//>` : null}
            ${trace === null ? html`<${Skeleton} rows=${3} />` : html`<${Timeline} events=${trace.events} />`}</div>` : null}
        </li>`;
      })}</ul>`}
      <div class="actions"><span class="hint">A branch that already has work?</span><${Button} variant="secondary" size="sm" onClick=${goLink}>Link a branch<//></div>`
    : html`
      <h3 class="sub">Linked branches</h3>
      ${linked === null ? html`<${Skeleton} rows=${2} />` : linked.length === 0 ? html`<p class="hint">No branch is linked to a task yet.</p>` : html`<ul class="stash-list addon-rows">${linked.map(b => html`<li>
        <strong class="mono">#${b.id}</strong><span class="msg mono" title=${b.name}>${b.name}</span>${b.title ? html`<span class="hint" title=${b.title}>${b.title}</span>` : null}
        <span class="row-actions"><${Button} size="sm" variant="ghost" title="Adds the pull request and the commits to the Customer report of the task (only adds; the text that is there is kept). It must be turned on in Add-ons first." onClick=${() => onRun("task-report", { branch: b.name }, "Customer report of task " + b.id + " from " + b.name)}>Report<//><${Button} size="sm" variant="ghost" title="The branch forgets the task and its steps leave the trace; the commits are not touched" onClick=${() => onRun("task-unbind", { branch: b.name }, "Unlink " + b.name + " from task " + b.id)}>Unlink<//></span></li>`)}</ul>`}
      <h3 class="sub">Link a branch to a task</h3>
      <p class="hint">For a branch that already has commits (or a pull request). The branch remembers the task, and what it already did (start, commits, pull request, merge) is added to the trace with its real dates. Run again, it adds only what is missing. Shared branches (the base, the integration and the release branch) cannot be linked.</p>
      ${linking ? html`
        <${Field} label="1. The branch" hint=${branch === current ? "the one you are on: type to search another" : !branch ? "type to search the branches" : local.includes(branch) ? "" : "there is no such branch here"}><${Combobox} label="Branch" exactOnly options=${names.map(n => ({ name: n }))} value=${branch} onChange=${setBranch} placeholder="Type to search the branches" /><//>
        <span class="field-label">2. The task</span>
        <${TaskPicker} repoId=${repoId} picked=${pick && !typed.trim() ? { addon: pick.addon, id: pick.task.id } : null} onPick=${(a, t) => { setPick({ addon: a, task: t }); setTyped(""); }} />
        <${Field} label="Or type it" hint="the number or the link of the task"><${Input} value=${typed} placeholder="e.g. 15530" onInput=${e => setTyped(e.target.value)} /><//>
        ${task ? html`<${Alert} tone="info" title="Ready to link"><span>Branch <code>${branch || "?"}</code> will be linked to task <strong>#${task}</strong>${pick && !typed.trim() ? " " + pick.task.title : ""}. The next step is a preview: nothing changes before you confirm.</span>
          ${pick && !typed.trim() ? html`<div class="actions"><${Button} size="sm" variant="ghost" onClick=${() => setPick(null)}>Clear the choice<//></div>` : null}<//>` : html`<p class="hint">Pick a task in the list, or type its number.</p>`}
        <div class="actions"><${Button} disabled=${!branch || !task || !local.includes(branch)} title=${!task ? "Pick a task or type it" : ""} onClick=${() => onRun("task-bind", { task, ...(addon ? { addon } : {}), branch }, "Link " + branch + " to task " + task)}>Preview and link<//><${Button} variant="ghost" onClick=${() => setLinking(false)}>Cancel<//></div>`
        : html`<div class="actions"><${Button} variant="secondary" onClick=${() => setLinking(true)}>Link a branch<//></div>`}`}
  <//>`;
}
