/* git-shuttle UI: one screen. The graph on the left, what to do next on the right. */
import { html, render, useState, useEffect, useCallback } from "../vendor/preact-htm.js";
import { api } from "./api.js";
import { useRunner } from "./runner.js";
import { Alert, Badge, Button, Input, Segmented, Toast } from "./components/ui.js";
import { GraphView } from "./components/graph-view.js";
import { OperationBanner, ReleaseTab, ResultCard, ShipTab, StartTab, settings, useGroups } from "./components/panel.js";
import { BranchPicker } from "./components/branch-picker.js";
import { ActionConfirm, BranchHereDialog, ContextMenu } from "./components/context-menu.js";
import { AddRepoDialog, HistoryDialog, SettingsDialog } from "./components/dialogs.js";
import { CommitPanel } from "./components/commit-panel.js";
import { ThemeToggle } from "./components/theme-toggle.js";
import { repoLabels } from "./repos.js";
import { OLD_SERVER, checkVersion } from "./version.js";

const changeCount = st => (st ? +st.staged + +st.unstaged + +st.untracked : 0);

// Where the user most likely is: on the integration branch → start a task; with work to send → ship it.
export function suggestTab(st) {
  if (!st || st.protected === "1") return "start";
  if (changeCount(st) > 0 || (+st["integration.ahead"] > 0 && st.merged !== "1")) return "ship";
  return "start";
}

function App() {
  const [repos, setRepos] = useState(null);
  const [repoId, setRepoId] = useState(null);
  const [status, setStatus] = useState(null);
  const [graph, setGraph] = useState(null);
  const [tab, setTab] = useState("start");
  const [dialog, setDialog] = useState(null);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [tested, setTested] = useState({});
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null);
  const [hidden, setHiddenState] = useState(new Set());
  const [worktree, setWorktree] = useState(null);   // the changed files, for the Ship tab
  const [oldServer, setOldServer] = useState(false);   // the server is older than this page
  const [selected, setSelected] = useState(null);   // the commit (or the working tree) whose details are open

  const say = (text, tone) => { setToast({ text, tone }); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), 5000); };
  const fail = e => say(e && e.message ? e.message : String(e), "bad");

  const loadRepos = async () => { const r = (await api("GET", "repos")).repos; setRepos(r); return r; };

  // the branches hidden from the graph are remembered per repository
  const hiddenKey = id => "shuttle.hidden." + id;
  const readHidden = id => { try { return new Set(JSON.parse(localStorage.getItem(hiddenKey(id)) || "[]")); } catch (e) { return new Set(); } };
  const fetchGraph = (id, hide) => {
    const known = branches ? [...branches.local, ...branches.remote] : null;
    return api("POST", "repos/" + id + "/graph", { refs: hide.size && known ? known.filter(b => !hide.has(b.ref)).map(b => b.ref) : null });
  };
  async function loadSnapshot(id, hide) {
    const [st, br] = await Promise.all([api("GET", "repos/" + id + "/status"), api("GET", "repos/" + id + "/branches")]);
    const known = [...br.local, ...br.remote];
    const refs = hide.size ? known.filter(b => !hide.has(b.ref)).map(b => b.ref) : null;
    const gr = await api("POST", "repos/" + id + "/graph", { refs });
    return { st: st.status, br, gr };
  }
  const reload = useCallback(async (id = repoId) => {
    if (!id) return;
    setLoading(true);
    try { const s = await loadSnapshot(id, hidden); setStatus(s.st); setBranches(s.br); setGraph(s.gr); } catch (e) { fail(e); }
    setLoading(false);
  }, [repoId, hidden]);
  async function setHidden(next) {
    setHiddenState(next);
    localStorage.setItem(hiddenKey(repoId), JSON.stringify([...next]));
    try { setGraph(await fetchGraph(repoId, next)); } catch (e) { fail(e); }
  }

  const runner = useRunner(repoId, {
    onError: fail,
    onDone: async job => { await reload(); say(job.state === "done" ? "Done" : job.state === "stopped" ? "Stopped: something needs your attention" : "Failed", job.state === "done" ? "ok" : "bad"); },
  });

  useEffect(() => {
    api("GET", "version").then(info => { if (!checkVersion(info).ok) setOldServer(true); }).catch(e => { if (e.oldServer) setOldServer(true); });
  }, []);
  useEffect(() => { loadRepos().then(list => { if (list.length) selectRepo(list.find(r => r.id === localStorage.getItem("shuttle.repo")) || list[0]); }).catch(fail); }, []);

  async function selectRepo(r) {
    setRepoId(r.id); localStorage.setItem("shuttle.repo", r.id); setSelected(null); setStatus(null); setGraph(null); setBranches(null); runner.reset();
    const hide = readHidden(r.id);
    setHiddenState(hide);
    try { const s = await loadSnapshot(r.id, hide); setStatus(s.st); setBranches(s.br); setGraph(s.gr); setTab(suggestTab(s.st)); } catch (e) { fail(e); }
  }

  const [groups, setGroups] = useGroups(status);
  // the files of the working tree are listed under each module of the Ship tab
  useEffect(() => {
    if (!repoId || !status) { setWorktree(null); return; }
    let alive = true;
    api("GET", "repos/" + repoId + "/worktree").then(w => alive && setWorktree(w)).catch(() => alive && setWorktree(null));
    return () => { alive = false; };
  }, [repoId, status]);
  const openFile = ({ path, group }) => setSelected({ type: "worktree", focus: { path, group } });
  const key = repoId + ":" + (status ? status.branch : "");

  async function addRepo(path, name) {
    try { const r = (await api("POST", "repos", name ? { path, name } : { path })).repo; setDialog(null); await loadRepos(); await selectRepo(r); } catch (e) { fail(e); }
  }
  async function removeRepo() {
    if (!window.confirm("Remove this repository from the list? The repository itself is not deleted.")) return;
    try { await api("POST", "repos/" + repoId + "/remove", {}); setDialog(null); const list = await loadRepos(); setStatus(null); setGraph(null); setRepoId(null); if (list.length) await selectRepo(list[0]); } catch (e) { fail(e); }
  }
  async function fetchRemote() {
    try { const r = await api("POST", "repos/" + repoId + "/fetch", {}); say(r.ok ? "Fetched" : "Fetch failed: " + r.output, r.ok ? "ok" : "bad"); await reload(); } catch (e) { fail(e); }
  }
  async function openHistory() { try { setHistory((await api("GET", "history")).history); setDialog("history"); } catch (e) { fail(e); } }
  // The display name is saved on its own; `git shuttle init` runs only when a setting changed.
  async function saveSettings({ name, nameChanged, settings: form, settingsChanged }) {
    setDialog(null);
    if (nameChanged) { try { await api("POST", "repos/" + repoId + "/rename", { name }); await loadRepos(); say("Renamed", "ok"); } catch (e) { fail(e); } }
    if (settingsChanged) runner.run("init", form, "Settings");
  }
  const selectCommit = sha => setSelected({ type: "commit", sha });
  function releasePullRequest() {
    const c = settings(status);
    if (window.confirm("Open a pull request from " + status.branch + " to " + c.release + "?")) runner.run("pr", { base: c.release, title: status.branch, body: "Release: " + status.branch }, "Pull request");
  }

  // ---- the right-click menu of a commit
  const copy = text => { try { navigator.clipboard.writeText(text); say("Copied", "ok"); } catch (e) { say("Copy it by hand: the browser blocked the clipboard", "bad"); } };
  const preview = (action, params, label, verb) => { setPending({ action, params, label, verb }); runner.preview(action, params); };
  function openMenu(x, y, commit, refs) {
    const here = status && status.branch;
    const busyReason = runner.busy ? "another action is running" : status && status.operation ? "finish the " + status.operation + " first" : "";
    let pickReason = busyReason;
    if (!pickReason && !here) pickReason = "you are not on a branch";
    if (!pickReason && status.protected === "1") pickReason = here + " is protected";
    if (!pickReason && commit.parents.length > 1) pickReason = "a merge commit: pick the commits it brought";
    if (!pickReason && refs.some(r => r.current)) pickReason = "this is where you are";
    if (!pickReason && +status.staged + +status.unstaged > 0) pickReason = "commit or stash your changes first";
    const items = [
      { label: "Cherry-pick onto " + (here || "…"), disabled: pickReason, run: () => preview("cherry-pick", { commits: [commit.sha] }, "Cherry-pick " + commit.sha.slice(0, 7), "Cherry-pick") },
      { label: "Create a branch here…", disabled: busyReason, run: () => setPending({ ask: true, commit }) },
    ];
    const localNames = new Set(((branches && branches.local) || []).map(b => b.name));
    for (const r of refs) {
      if (r.kind === "local" && !r.current) items.push({ label: "Switch to " + r.name, disabled: busyReason, run: () => preview("switch", { name: r.name }, "Switch to " + r.name, "Switch") });
      if (r.kind === "remote" && !localNames.has(r.name.replace(/^[^/]+\//, ""))) items.push({ label: "Check out " + r.name + " (local copy)", disabled: busyReason, run: () => preview("switch", { name: r.name }, "Check out " + r.name, "Check out") });
    }
    items.push("-", { label: "Copy commit SHA", run: () => copy(commit.sha) }, { label: "Copy message", run: () => copy(commit.subject) });
    setMenu({ x, y, title: commit.sha.slice(0, 7) + " · " + commit.subject, items });
  }

  if (repos === null) return html`<div class="empty">Loading…</div>`;
  const repo = repos.find(r => r.id === repoId);
  const c = settings(status);
  const ahead = status ? +status["integration.ahead"] : 0, behind = status ? +status["integration.behind"] : 0;

  return html`<div class="app">
    ${oldServer ? html`<div class="banner" role="alert"><strong>${OLD_SERVER}</strong></div>` : null}
    <header class="topbar">
      <span class="brand">git-<b>shuttle</b></span>
      ${repos.length ? html`<select class="input repo-select" value=${repoId || ""} onChange=${e => selectRepo(repos.find(r => r.id === e.target.value))} aria-label="Repository">${repoLabels(repos).map(l => html`<option value=${l.id} title=${l.title}>${l.label}</option>`)}</select>` : null}
      <${Button} variant="ghost" size="sm" onClick=${() => setDialog("add")}>+ Add<//>
      ${status ? html`<${BranchPicker} status=${status} branches=${branches} hidden=${hidden} setHidden=${setHidden} onSwitch=${name => runner.run("switch", { name }, "Switch to " + name)} disabled=${runner.busy} />
        ${status.protected === "1" ? html`<${Badge} tone="warn">protected<//>` : null}
        ${status["integration.ref"] ? html`<span class="hint">↑${ahead} ↓${behind} vs ${status["integration.ref"]}</span>` : null}` : null}
      <span class="grow" />
      ${repoId ? html`<${Button} variant="ghost" size="sm" onClick=${fetchRemote}>Fetch<//><${Button} variant="ghost" size="sm" onClick=${() => setDialog("settings")}>Settings<//>` : null}
      <${Button} variant="ghost" size="sm" onClick=${openHistory}>History<//>
      <${ThemeToggle} />
    </header>

    ${!repos.length ? html`<main class="onboarding"><h1>Add your first repository</h1><p class="lead">git-shuttle shows the commit graph and walks a task from branch to merge to release.</p>
      <${Button} onClick=${() => setDialog("add")}>Add a repository<//></main>` : html`<main class="split">
      <section class="graph-pane" aria-label="Commit graph">
        <div class="graph-scroll"><${GraphView} graph=${graph} changes=${changeCount(status)} loading=${loading} onMenu=${openMenu} hidden=${hidden} selected=${selected} onSelect=${setSelected} /></div>
        ${selected && repoId ? html`<${CommitPanel} repoId=${repoId} selected=${selected} remotes=${(graph && graph.remotes) || []} onSelectCommit=${selectCommit} onClose=${() => setSelected(null)} onCopy=${copy} />` : null}
      </section>
      <aside class="panel" aria-label="Next step">
        ${repo && repo.error ? html`<${Alert} tone="bad" title="Cannot read this repository">${repo.error}<//>` : null}
        ${status ? html`
          <${ResultCard} runner=${runner} onPullRequest=${releasePullRequest} />
          <${OperationBanner} status=${status} runner=${runner} />
          ${status["config.set"] === "0" ? html`<${Alert} tone="info" title="Using the default settings"><span>Integration <code>${c.integration || "?"}</code>, release <code>${c.release || "?"}</code>.</span> <a href="#" onClick=${e => { e.preventDefault(); setDialog("settings"); }}>Change</a><//>` : null}
          <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: "start", label: "Start" }, { value: "ship", label: "Ship" + (changeCount(status) ? " · " + changeCount(status) : "") }, { value: "release", label: "Release" }]} />
          ${tab === "start" ? html`<${StartTab} status=${status} runner=${runner} />` : null}
          ${tab === "ship" ? html`<${ShipTab} status=${status} runner=${runner} groups=${groups} setGroups=${setGroups} tested=${!!tested[key]} setTested=${v => setTested({ ...tested, [key]: v })} worktree=${worktree} onOpenFile=${openFile} />` : null}
          ${tab === "release" ? html`<${ReleaseTab} repoId=${repoId} status=${status} runner=${runner} onError=${fail} onLoaded=${() => reload()} />` : null}
` : html`<p class="hint">Loading…</p>`}
      </aside></main>`}

    ${dialog === "add" ? html`<${AddRepoDialog} onAdd=${addRepo} onClose=${() => setDialog(null)} />` : null}
    ${dialog === "settings" && status ? html`<${SettingsDialog} status=${status} branches=${branches} repoName=${repo ? repo.name : ""} onSave=${saveSettings} onRemove=${removeRepo} onClose=${() => setDialog(null)} />` : null}
    ${dialog === "history" ? html`<${HistoryDialog} history=${history} onClose=${() => setDialog(null)} />` : null}
    ${menu ? html`<${ContextMenu} menu=${menu} onClose=${() => setMenu(null)} />` : null}
    ${pending && pending.ask ? html`<${BranchHereDialog} commit=${pending.commit} onClose=${() => setPending(null)} onSubmit=${name => preview("branch", { name, commit: pending.commit.sha }, "Create branch " + name, "Create branch")} />` : null}
    ${pending && !pending.ask ? html`<${ActionConfirm} pending=${pending} runner=${runner} onClose=${() => setPending(null)} />` : null}
    <${Toast} toast=${toast} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
