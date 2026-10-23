/* git-shuttle UI: one screen. The graph on the left, what to do next on the right. */
import { html, render, useState, useEffect, useCallback, useRef, useMemo } from "../vendor/preact-htm.js";
import { api } from "./api.js";
import { useRunner } from "./runner.js";
import { Alert, Badge, Button, ProgressBar, Segmented } from "./components/ui.js";
import { ConfirmDialog } from "./components/confirm.js";
import { ToastHost, useToasts } from "./components/toast-host.js";
import { describeJob, fetchToast, toToast } from "./feedback.js";
import { GH_MISSING, branchTemplates, ghMissing, releaseReady, resolveRequest } from "./logic.js";
import { isPreviewSkipped } from "./skip-preview.js";
import { GraphView } from "./components/graph-view.js";
import { DeployTab } from "./components/deploy-tab.js";
import { OperationBanner, ReleaseTab, ResultCard, ShipTab, StartTab, settings, useGroups } from "./components/panel.js";
import { BranchPicker } from "./components/branch-picker.js";
import { ActionConfirm, BranchHereDialog, ContextMenu, DivergedDialog } from "./components/context-menu.js";
import { pushState, pushTitle } from "./pushstate.js";
import { AddRepoDialog, SettingsDialog } from "./components/dialogs.js";
import { FormDialog } from "./components/form-dialog.js";
import { AddonCards, AddonSetupDialog, AddonsDialog, TasksDialog } from "./components/addons.js";
import { ConflictDialog } from "./components/conflict-dialog.js";
import { CompareDialog, JournalDialog, PatchDialog, RewriteDialog, ShortcutsDialog, StashDialog, WorktreesDialog } from "./components/ops-dialogs.js";
import { Toolbar } from "./components/toolbar.js";
import { Palette } from "./components/palette.js";
import { LogPanel } from "./components/log-panel.js";
import { NEEDS_TARGET, OPS, branchMenuIds, commitMenuIds, labelOf, lineFrom, menuItems, pushedShas, reasonOf, shortcutFor } from "./ops.js";
import { CommitPanel } from "./components/commit-panel.js";
import { Splitter, useSize, useSplit } from "./components/splitter.js";
import { ThemeToggle } from "./components/theme-toggle.js";
import { repoLabels } from "./repos.js";
import { suggestTab } from "./tabs.js";
import { OLD_SERVER, checkVersion } from "./version.js";
import { AUTHOR_SHORT, LINKS, versionLine } from "./brand.js";
import { AboutDialog } from "./components/about-dialog.js";
import { UpdateBanner } from "./components/update-banner.js";
import { hiddenFor, pickerFrom, pickerToPref } from "./prefs.js";
import { loadPrefs, savePref, syncStorage } from "./prefs-store.js";
import { currentTheme } from "./theme.js";
import { BrandMark, ExternalLink } from "./components/links.js";

const changeCount = st => (st ? +st.staged + +st.unstaged + +st.untracked : 0);

function App() {
  const [repos, setRepos] = useState(null);
  const [repoId, setRepoId] = useState(null);
  const [status, setStatus] = useState(null);
  const [graph, setGraph] = useState(null);
  const [taskMap, setTaskMap] = useState(null);       // which commits and branches are for a task (the add-ons): marked in the graph
  useEffect(() => {
    if (!repoId || !graph) return undefined;
    let alive = true;
    api("GET", "repos/" + repoId + "/trace/map").then(d => { if (alive) setTaskMap(d); }, () => { if (alive) setTaskMap(null); });
    return () => { alive = false; };
  }, [repoId, graph]);
  const [tab, setTab] = useState("start");
  const [dialog, setDialog] = useState(null);
  const [modal, setModal] = useState(null);           // the dialogs of the actions: { name, ... }
  const [catalog, setCatalog] = useState([]);           // every action, from the server (for the palette)
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState("");   // "addon:id": the graph shows only the work of that task
  // the tasks that have work in the graph, with how many commits: to narrow the graph to one
  const taskList = useMemo(() => {
    if (!taskMap || !taskMap.tasks) return [];
    const counts = {};
    Object.values(taskMap.commits || {}).forEach(([a, id]) => { counts[a + ":" + id] = (counts[a + ":" + id] || 0) + 1; });
    const out = Object.keys(taskMap.tasks).map(key => ({ key, id: key.split(":").slice(1).join(":"), title: (taskMap.tasks[key].title || "").slice(0, 50), count: counts[key] || 0 }));
    return out.sort((x, y) => y.id.localeCompare(x.id, undefined, { numeric: true }));
  }, [taskMap]);
  const activeTask = taskList.some(t => t.key === taskFilter) ? taskFilter : "";
  const [logVersion, setLogVersion] = useState(0);      // changes when an action finishes: an open log reloads
  const searchRef = useRef(null);
  const [toasts, queue] = useToasts();
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [freshShas, setFreshShas] = useState(null);   // commits the last fetch brought, shown with a short glow
  const [tested, setTested] = useState({});
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null);
  const [hidden, setHiddenState] = useState(new Set());
  const [worktree, setWorktree] = useState(null);   // the changed files, for the Ship tab
  const [oldServer, setOldServer] = useState(false);   // the server is older than this page
  const [serverVersion, setServerVersion] = useState("");
  const [aboutAuto, setAboutAuto] = useState(false);   // opened to look for an update
  const [notice, setNotice] = useState(null);          // is a newer release out (a look at most once an hour, by the server or by any command)
  const [selected, setSelected] = useState(null);   // the commit (or the working tree) whose details are open
  const mainRef = useRef(null), paneRef = useRef(null);
  const mainSize = useSize(mainRef), paneSize = useSize(paneRef);
  const panelSplit = useSplit("panel", { initial: 400, min: 320, otherMin: 420, total: mainSize.width });       // the side panel
  const detailSplit = useSplit("detail", { initial: 360, min: 160, otherMin: 120, total: paneSize.height });     // the details under the graph

  const notify = spec => queue.push(spec);
  const fail = (e, what = "Something went wrong") => notify({ variant: "error", title: what, detail: e && e.message ? e.message : String(e) });
  // A dialog instead of the browser's confirm(): resolves to true or false.
  const confirm = request => new Promise(resolve => setConfirmRequest({ ...request, resolve }));
  const answer = yes => { confirmRequest.resolve(yes); setConfirmRequest(null); };
  const showLog = () => { const card = document.querySelector(".result"); if (card) { card.scrollIntoView({ block: "nearest" }); card.focus && card.focus(); } };

  const loadRepos = async () => { const r = (await api("GET", "repos")).repos; setRepos(r); return r; };

  // what is remembered (the branches hidden from the graph per repository, the state of the branch list, the repository you were on) is kept by
  // the server: the storage of the browser is per address and port, and the server takes another port when 7788 is busy
  const prefs = useRef({});
  const readHidden = id => {
    const { hidden: found, migrate } = hiddenFor(prefs.current, id, localStorage);
    if (migrate) { prefs.current["hidden:" + id] = [...found]; savePref("hidden:" + id, [...found]); }      // what this browser kept before: sent once
    return found;
  };
  const remember = (key, value) => { prefs.current[key] = value; savePref(key, value); };
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
    remember("hidden:" + repoId, [...next]);
    try { setGraph(await fetchGraph(repoId, next)); } catch (e) { fail(e); }
  }

  const runner = useRunner(repoId, {
    onError: fail,
    onDone: async job => {
      await reload();
      setLogVersion(v => v + 1);
      if (["stage", "unstage", "discard"].includes(job.action)) setSelected(s => (s && s.type === "worktree" ? { ...s, version: (s.version || 0) + 1 } : s));
      notify(toToast(describeJob(job, { branch: status && status.branch }), { showLog }));
      if (job.action === "start" && job.state === "done") setTab("ship");     // the next step
    },
  });

  useEffect(() => {
    const look = () => api("GET", "update/notice").then(setNotice, () => { /* no answer: no reminder */ });
    look();
    const again = setInterval(look, 10 * 60 * 1000);       // the server reads a file (a look at the network is made at most once an hour), and the commands of git-shuttle keep it fresh
    const back = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", back);
    api("GET", "version").then(info => { if (info && info.version) setServerVersion(info.version); if (!checkVersion(info).ok) setOldServer(true); }).catch(e => { if (e.oldServer) setOldServer(true); });
    return () => { clearInterval(again); document.removeEventListener("visibilitychange", back); };
  }, []);
  useEffect(() => {
    loadPrefs().then(p => { prefs.current = p; return loadRepos(); })
      .then(list => { if (list.length) selectRepo(list.find(r => r.id === (prefs.current.repo || localStorage.getItem("shuttle.repo"))) || list[0]); }).catch(fail);
  }, []);

  async function selectRepo(r) {
    setRepoId(r.id); localStorage.setItem("shuttle.repo", r.id); if (prefs.current.repo !== r.id) remember("repo", r.id); setSelected(null); setStatus(null); setGraph(null); setBranches(null); runner.reset();
    const hide = readHidden(r.id);
    setHiddenState(hide);
    setLoading(true);
    try { const s = await loadSnapshot(r.id, hide); setStatus(s.st); setBranches(s.br); setGraph(s.gr); setTab(suggestTab(s.st)); } catch (e) { fail(e, "Cannot read this repository"); }
    setLoading(false);
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
    if (!await confirm({ title: "Remove this repository?", body: "It leaves the list. The repository itself is not deleted.", confirmLabel: "Remove", tone: "destructive" })) return;
    try { await api("POST", "repos/" + repoId + "/remove", {}); setDialog(null); const list = await loadRepos(); setStatus(null); setGraph(null); setRepoId(null); if (list.length) await selectRepo(list[0]); } catch (e) { fail(e); }
  }
  async function fetchRemote() {
    setFetching(true);
    try {
      const result = await api("POST", "repos/" + repoId + "/fetch", {});
      notify(toToast(fetchToast(result)));
      await reload();
      if (result.summary && result.summary.new_shas.length) {
        setFreshShas(new Set(result.summary.new_shas));
        setTimeout(() => setFreshShas(null), 4500);
      }
    } catch (e) { fail(e, "Fetch failed"); }
    setFetching(false);
  }
  // The display name is saved on its own; `git shuttle init` runs only when a setting changed.
  async function saveSettings({ name, nameChanged, settings: form, settingsChanged }) {
    setDialog(null);
    if (nameChanged) { try { await api("POST", "repos/" + repoId + "/rename", { name }); await loadRepos(); notify({ variant: "success", title: "Renamed", detail: name }); } catch (e) { fail(e, "Rename failed"); } }
    if (settingsChanged) runner.run("init", form, "Settings");
  }
  // Publish and Push show their dry run first; a diverged branch asks for the force explicitly, in its own dialog.
  function startPush() {
    if (push.kind === "diverged") { setPending({ diverged: true }); runner.preview("push", { force: true }); return; }
    preview("push", {}, (push.kind === "publish" ? "Publish " : "Push ") + push.branch, push.kind === "publish" ? "Publish" : "Push");
  }
  // The files of the working tree: stage, unstage, discard (with a confirmation that lists what is lost).
  const names = rows => (rows.length === 1 ? rows[0].path : rows.length + " files");
  const fileActions = {
    stage: rows => runner.run("stage", { paths: rows.map(f => f.path) }, "Stage " + names(rows)),
    unstage: rows => runner.run("unstage", { paths: rows.map(f => f.path) }, "Unstage " + names(rows)),
    toggle: rows => {
      const toStage = rows.filter(f => f.group !== "staged"), toUnstage = rows.filter(f => f.group === "staged");
      (toStage.length >= toUnstage.length ? fileActions.stage(toStage) : fileActions.unstage(toUnstage));
    },
    discard: async rows => {
      const untracked = rows.filter(f => f.group === "untracked"), staged = rows.some(f => f.group === "staged");
      const list = rows.slice(0, 8).map(f => "• " + f.path).join("\n") + (rows.length > 8 ? "\n… and " + (rows.length - 8) + " more" : "");
      const yes = await confirm({
        title: "Discard changes to " + names(rows) + "?", confirmLabel: "Discard", tone: "destructive",
        body: list + "\n\nThis cannot be undone." + (untracked.length ? "\n" + untracked.length + " untracked " + (untracked.length === 1 ? "file is" : "files are") + " deleted." : ""),
      });
      if (yes) runner.run("discard", { paths: rows.map(f => f.path), staged, untracked: untracked.length > 0 }, "Discard " + names(rows));
    },
  };
  const switchTo = name => preview("switch", { name }, "Switch to " + name, "Switch");
  const selectCommit = sha => setSelected({ type: "commit", sha });
  // keep one whole side of a file in conflict: the preview says which branch is kept and which is dropped
  const resolveFile = (side, file) => { const r = resolveRequest(status, side, file); preview(r.action, r.params, r.label, r.verb); };
  async function releasePullRequest() {
    const c = settings(status);
    if (ghMissing(status)) { notify({ variant: "error", title: GH_MISSING.title, detail: GH_MISSING.text }); return; }
    const ready = releaseReady(status);
    const base = (ready && ready.base) || c.release;
    if (await confirm({ title: "Open a pull request?", body: "From " + status.branch + " to " + base + ".", confirmLabel: "Open pull request" })) {
      runner.run("pr", { base, title: status.branch, body: "Release: " + status.branch }, "Pull request");
    }
  }

  // ---- the right-click menu of a commit
  const copy = text => {
    navigator.clipboard.writeText(text).then(() => notify({ variant: "success", title: "Copied" }),
      () => notify({ variant: "warning", title: "Could not copy", detail: "The browser blocked the clipboard: select the text and copy it by hand." }));
  };
  const preview = (action, params, label, verb, tone) => {
    // a safe action whose preview was turned off runs at once (the server checks it again, and a refusal is shown as an error)
    if (isPreviewSkipped(action, params, tone)) { runner.run(action, params, label); return; }
    setPending({ action, params, label, verb, tone }); runner.preview(action, params);
  };
  // double click on a row: check out what it stands for (a branch label, else the commit itself), after a preview
  function openCommit(commit, refs) {
    if (runner.busy || (status && status.operation)) return;
    const localNames = new Set(((branches && branches.local) || []).map(b => b.name));
    const local = refs.find(r => r.kind === "local" && !r.current);
    const remote = refs.find(r => r.kind === "remote" && !localNames.has(r.name.replace(/^[^/]+\//, "")));
    if (refs.some(r => r.current) && !local && !remote) return;
    if (local) preview("switch", { name: local.name }, "Switch to " + local.name, "Switch");
    else if (remote) preview("switch", { name: remote.name }, "Check out " + remote.name, "Check out");
    else preview("switch-detach", { commit: commit.sha }, "Check out " + commit.sha.slice(0, 7), "Check out");
  }
  function openMenu(x, y, commit, refs) {
    const items = menuItems(ctx, commitMenuIds(commit, refs), { commit }).map(it => (it === "-" ? it : { label: it.label, disabled: it.reason, run: () => perform(it.id, it.args) }));
    const busyReason = reasonOf("switch", ctx, { name: "" });
    const localNames = new Set(((branches && branches.local) || []).map(b => b.name));
    const where = [];
    for (const r of refs) {
      if (r.kind === "local" && !r.current) where.push({ label: "Switch to " + r.name, disabled: busyReason, run: () => perform("switch", { name: r.name }) });
      if (r.kind === "remote" && !localNames.has(r.name.replace(/^[^/]+\//, ""))) where.push({ label: "Check out " + r.name + " (local copy)", disabled: busyReason, run: () => perform("switch", { name: r.name }) });
    }
    setMenu({ x, y, title: commit.sha.slice(0, 7) + " · " + commit.subject, items: [...items, ...(where.length ? ["-", ...where] : []), "-", { label: "Copy commit SHA", run: () => copy(commit.sha) }, { label: "Copy message", run: () => copy(commit.subject) }] });
  }
  function openBranchMenu(x, y, branch) {
    const items = menuItems(ctx, branchMenuIds(branch, ctx), { branch }).map(it => (it === "-" ? it : { label: it.label, disabled: it.reason, run: () => perform(it.id, it.args) }));
    setMenu({ x, y, title: branch.name, items: [...items, "-", { label: "Copy branch name", run: () => copy(branch.name) }] });
  }

  // ---- every action goes through here: the palette, the toolbar, the menus and the shortcuts
  const commitMap = useMemo(() => new Map(((graph && graph.commits) || []).map(c => [c.sha, c])), [graph]);
  const headSha = useMemo(() => { const c = ((graph && graph.commits) || []).find(x => x.refs.some(r => r === "HEAD" || r.startsWith("HEAD -> "))); return c ? c.sha : ""; }, [graph]);
  const pushed = useMemo(() => pushedShas((graph && graph.commits) || [], (graph && graph.remotes) || []), [graph]);
  const ctx = { status, branches, busy: runner.busy || loading, commits: commitMap, headSha, pushed, protectedNames: status ? (status["config.protected"] || "").split(/[\s,]+/).filter(Boolean) : [] };
  function submitRequest(req) { if (req.direct) runner.run(req.action, req.params, req.label); else preview(req.action, req.params, req.label, req.verb, req.tone); }
  const opening = useRef(false), typedEarly = useRef({ text: "", enter: false });       // keys typed between Ctrl+K and the palette appearing
  function perform(id, args = {}) {
    if (id === "palette") { opening.current = true; typedEarly.current = { text: "", enter: false }; setModal({ name: "palette" }); return; }
    if (id === "search") { searchRef.current && searchRef.current.focus(); return; }
    const op = OPS[id];
    if (!op || !status) return;
    const reason = reasonOf(id, ctx, args);
    if (reason) { notify({ variant: "warning", title: labelOf(id, ctx, args, id) + " is not available", detail: reason }); return; }
    switch (op.special) {
      case "fetch": fetchRemote(); return;
      case "push": if (push.kind === "none") { notify({ variant: "info", title: "Nothing to push" }); return; } startPush(); return;
      case "start": setTab("start"); return;
      case "tab": setTab(id === "release" ? "release" : /^deploy/.test(id) ? "deploy" : "ship"); return;
      case "compare": setModal({ name: "compare", a: args.a || (args.commit && args.commit.sha), b: args.b }); return;
      case "rewrite": { const line = lineFrom(ctx, args.commit.sha); if (line) setModal({ name: "rewrite", line }); return; }
      case "patch": setModal({ name: "patch", commit: args.commit }); return;
      case "link": api("GET", "repos/" + repoId + "/commits/" + args.commit.sha + "/link").then(d => copy(d.url), e => fail(e, "Cannot make the link")); return;
      case "stashes": setModal({ name: "stash" }); return;
      case "worktrees": setModal({ name: "worktrees" }); return;
      case "addons": setModal({ name: "addons" }); return;
      case "tasks": setModal({ name: "tasks" }); return;
      case "journal": setModal({ name: "journal" }); return;
      case "log": setModal({ name: "log" }); return;
      case "settings": setDialog("settings"); return;
      case "add": setDialog("add"); return;
      case "shortcuts": setModal({ name: "shortcuts" }); return;
      case "about": setAboutAuto(id === "update"); setDialog("about"); return;
      case "conflict": notify({ variant: "info", title: "Keep one side of a conflict", detail: "Use the buttons next to each file, in the banner at the top of the panel." }); return;
      case "files": return;
      default:
    }
    if (op.form) { setModal({ name: "form", id, args, fields: op.form(ctx, args), commit: args.commit }); return; }
    submitRequest(op.request(ctx, args, {}));
  }
  const paletteEntries = () => catalog.filter(a => OPS[a.id] && !["files", "palette"].includes(OPS[a.id].special))
    .map(a => ({ ...a, label: labelOf(a.id, ctx, {}, a.label), reason: NEEDS_TARGET.has(a.id) ? "choose a " + (/branch|rename|upstream|merge-in|rebase-on|update-branch|delete|switch$/.test(a.id) ? "branch" : "commit") + " in the list, then use its menu" : reasonOf(a.id, ctx, {}) }));
  useEffect(() => { api("GET", "actions").then(d => setCatalog(d.actions)).catch(() => {}); }, []);
  const latest = useRef(null);
  latest.current = { modal, dialog, confirmRequest, menu, perform };
  useEffect(() => {          // one listener for the life of the page; it reads the newest state
    const onKey = e => {
      const now = latest.current;
      if (opening.current && document.activeElement && document.activeElement.classList.contains("palette-input")) opening.current = false;     // it is up and has the focus: keys go to it
      if (opening.current && e.key === "Escape") { opening.current = false; e.preventDefault(); setModal(null); return; }
      if (opening.current && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace")) {
        if (e.key === "Enter") typedEarly.current.enter = true; else if (e.key === "Backspace") typedEarly.current.text = typedEarly.current.text.slice(0, -1); else typedEarly.current.text += e.key;
        e.preventDefault(); return;
      }
      if (now.modal || now.dialog || now.confirmRequest || now.menu) { if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return; }
      const id = shortcutFor(e);
      if (!id) return;
      e.preventDefault();
      now.perform(id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // the dialogs of the actions
  const closeModal = () => setModal(null);
  const rerun = e => { setModal(null); preview(e.action, e.params, e.label || e.action, "Run again"); };
  const stashAction = (sub, index) => { setModal(null); preview("stash", { sub, index }, (sub === "drop" ? "Drop" : sub === "pop" ? "Pop" : "Apply") + " stash@{" + index + "}", sub === "drop" ? "Drop" : sub === "pop" ? "Pop" : "Apply", sub === "drop" ? "destructive" : undefined); };
  const copyText = text => copy(text);
  function modalView() {
    if (!modal) return null;
    switch (modal.name) {
      case "form": {
        const op = OPS[modal.id];
        return html`<${FormDialog} title=${labelOf(modal.id, ctx, modal.args, modal.id)} fields=${modal.fields} repoId=${repoId} commit=${modal.commit} onClose=${closeModal}
          onSubmit=${values => { setModal(null); submitRequest(op.request(ctx, modal.args, values)); }} />`;
      }
      case "palette": return html`<${Palette} entries=${paletteEntries()} early=${typedEarly} onReady=${() => { opening.current = false; }} onClose=${() => { opening.current = false; closeModal(); }} onPick=${e => perform(e.id)} />`;
      case "shortcuts": return html`<${ShortcutsDialog} onClose=${closeModal} />`;
      case "log": return html`<${LogPanel} repos=${repos} version=${logVersion} onClose=${closeModal} onRerun=${rerun} onCopy=${copyText} notify=${notify} confirm=${confirm} />`;
      case "conflict": return html`<${ConflictDialog} repoId=${repoId} file=${modal.file} status=${status} onClose=${closeModal} onSubmit=${req => { setModal(null); preview(req.action, req.params, req.label, req.verb); }} />`;
      case "stash": return html`<${StashDialog} repoId=${repoId} onAction=${stashAction} onClose=${closeModal} notify=${notify} />`;
      case "addons": return html`<${AddonsDialog} repoId=${repoId} notify=${notify} onClose=${closeModal} onSetup=${addon => setModal({ name: "addon-setup", addon })} onRun=${(action, params, label) => { setModal(null); preview(action, params, label, { "addon-enable": "Enable", "addon-install": "Install", "addon-uninstall": "Remove", "addon-report": "Apply" }[action] || "Disable", action === "addon-uninstall" ? "destructive" : undefined); }} />`;
      case "addon-setup": return html`<${AddonSetupDialog} repoId=${repoId} name=${modal.addon} notify=${notify} onClose=${closeModal} />`;
      case "tasks": return html`<${TasksDialog} repoId=${repoId} branches=${branches} current=${status.branch} notify=${notify} onClose=${closeModal} onRun=${(action, params, label) => { setModal(null); preview(action, params, label, action === "task-unbind" ? "Unlink" : action === "task-report" ? "Add" : "Link", action === "task-unbind" ? "destructive" : undefined); }} />`;
      case "worktrees": return html`<${WorktreesDialog} repoId=${repoId} branches=${branches} notify=${notify} onClose=${closeModal} onRun=${(action, params, label) => { setModal(null); preview(action, params, label, action === "worktree-remove" ? "Remove" : "Add", action === "worktree-remove" ? "destructive" : undefined); }} />`;
      case "journal": return html`<${JournalDialog} repoId=${repoId} status=${status} notify=${notify} onClose=${closeModal} onAction=${id => { setModal(null); perform(id); }} />`;
      case "compare": return html`<${CompareDialog} repoId=${repoId} branches=${branches} a=${modal.a} b=${modal.b} notify=${notify} onClose=${closeModal} />`;
      case "patch": return html`<${PatchDialog} repoId=${repoId} commit=${modal.commit} notify=${notify} onCopy=${copyText} onClose=${closeModal} />`;
      case "rewrite": return html`<${RewriteDialog} line=${modal.line} onClose=${closeModal} onSubmit=${({ base, plan }) => { setModal(null); preview("rewrite", { base, plan }, "Interactive rebase of " + status.branch, "Rewrite", "destructive"); }} />`;
      default: return null;
    }
  }

  if (repos === null) return html`<div class="empty">Loading…</div>`;
  const repo = repos.find(r => r.id === repoId);
  const c = settings(status);
  const ahead = status ? +status["integration.ahead"] : 0, behind = status ? +status["integration.behind"] : 0;
  const push = pushState(status);

  return html`<div class="app">
    ${oldServer ? html`<div class="banner" role="alert"><strong>${OLD_SERVER}</strong></div>` : null}
    <header class="topbar">
      <button type="button" class="brand" onClick=${() => { setAboutAuto(false); setDialog("about"); }} aria-label="About git-shuttle" title="About git-shuttle"><${BrandMark} size=${22} /><span>git-<b>shuttle</b></span></button>
      ${repos.length ? html`<select class="input repo-select" value=${repoId || ""} onChange=${e => selectRepo(repos.find(r => r.id === e.target.value))} aria-label="Repository">${repoLabels(repos).map(l => html`<option value=${l.id} title=${l.title}>${l.label}</option>`)}</select>` : null}
      <${Button} variant="ghost" size="sm" onClick=${() => setDialog("add")}>+ Add<//>
      ${status ? html`<${BranchPicker} status=${status} branches=${branches} hidden=${hidden} setHidden=${setHidden} saved=${pickerFrom(prefs.current)} onSaved=${(sections, closed) => remember("picker", pickerToPref(sections, closed))} onSwitch=${name => runner.run("switch", { name }, "Switch to " + name)} disabled=${runner.busy} onMenu=${openBranchMenu} onCompare=${b => setModal({ name: "compare", a: b.upstream, b: b.name })} />
        ${status.protected === "1" ? html`<${Badge} tone="warn">protected<//>` : null}
        ${status["integration.ref"] ? html`<span class="hint">↑${ahead} ↓${behind} vs ${status["integration.ref"]}</span>${behind > 0 && !reasonOf("sync", ctx) ? html`<${Button} variant="outline" size="sm" class="behind-btn" title=${"Rebase this branch on " + status["integration.ref"]} onClick=${() => perform("sync")}>↓${behind} behind ${status["integration.ref"]}: update<//>` : null}` : null}` : null}
      <span class="grow" />
      ${repoId ? html`<${Button} variant="ghost" size="sm" onClick=${fetchRemote} busy=${fetching}>${fetching ? "Fetching…" : "Fetch"}<//><${Button} variant="ghost" size="sm" onClick=${() => setModal({ name: "tasks" })} title="Tasks and their trace">Tasks<//><button type="button" class="icon-btn" onClick=${() => setModal({ name: "addons" })} aria-label="Add-ons" title="Add-ons"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12v6a2 2 0 0 1-2 2h-4v-2.5a1.5 1.5 0 0 0-3 0V20H6a2 2 0 0 1-2-2v-4h2.5a1.5 1.5 0 0 0 0-3H4V6a2 2 0 0 1 2-2h4V3.5a2.5 2.5 0 0 1 5 0V4h3a2 2 0 0 1 2 2v3h-.5a1.5 1.5 0 0 0 0 3z"/></svg></button><${Button} variant="ghost" size="sm" onClick=${() => setDialog("settings")}>Settings<//>` : null}
            <${ThemeToggle} />
    </header>
    <${UpdateBanner} notice=${notice} notify=${notify} onHowTo=${() => { setAboutAuto(true); setDialog("about"); }} onLater=${() => api("POST", "update/notice", { snooze: notice.latest }).then(setNotice, e => fail(e))} />
    <${ProgressBar} active=${runner.busy || loading || fetching} />
    ${status && repos.length ? html`<${Toolbar} ctx=${ctx} perform=${perform} search=${search} setSearch=${setSearch} searchRef=${searchRef} push=${push} taskList=${taskList} taskFilter=${activeTask} setTaskFilter=${setTaskFilter} />` : null}

    ${!repos.length ? html`<main class="onboarding"><${BrandMark} size=${56} class="onboarding-mark" /><h1>Add your first repository</h1><p class="lead">git-shuttle shows the commit graph and walks a task from branch to merge to release.</p>
      <${Button} onClick=${() => setDialog("add")}>Add a repository<//></main>` : html`<main class="split" ref=${mainRef} style=${{ "--panel-w": panelSplit.size + "px" }}>
      <section class="graph-pane" aria-label="Commit graph" ref=${paneRef}>
        <div class="graph-scroll"><${GraphView} graph=${graph} changes=${changeCount(status)} loading=${loading} onMenu=${openMenu} hidden=${hidden} selected=${selected} onSelect=${setSelected} onOpen=${openCommit} fresh=${freshShas} onCopy=${copy} filter=${search} tasks=${taskMap} taskFilter=${activeTask} onClearTask=${() => setTaskFilter("")} /></div>
        ${selected && repoId ? html`<${Splitter} split=${detailSplit} axis="y" grow=${-1} label="Resize the details" />
          <${CommitPanel} key=${selected.type === "worktree" ? "worktree" : selected.sha} repoId=${repoId} selected=${selected} remotes=${(graph && graph.remotes) || []} height=${detailSplit.size} onSelectCommit=${selectCommit} onClose=${() => setSelected(null)} onCopy=${copy} actions=${fileActions} />` : null}
      </section>
      <${Splitter} split=${panelSplit} axis="x" grow=${-1} label="Resize the side panel" />
      <aside class="panel" aria-label="Next step">
        ${repo && repo.error ? html`<${Alert} tone="bad" title="Cannot read this repository">${repo.error}<//>` : null}
        ${status ? html`
          <${ResultCard} runner=${runner} onPullRequest=${releasePullRequest} ready=${!!releaseReady(status)} />
          <${OperationBanner} status=${status} runner=${runner} confirm=${confirm} onResolve=${resolveFile} onHunks=${file => setModal({ name: "conflict", file })} />
          ${status["config.set"] === "0" ? html`<${Alert} tone="info" title="Using the default settings"><span>Integration <code>${c.integration || "?"}</code>, release <code>${c.release || "?"}</code>.</span> <a href="#" onClick=${e => { e.preventDefault(); setDialog("settings"); }}>Change</a><//>` : null}
          <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: "start", label: "Start" }, { value: "ship", label: "Ship" + (changeCount(status) ? " · " + changeCount(status) : "") }, { value: "release", label: "Release" }, { value: "deploy", label: "Deploy" }]} />
          ${tab === "start" || tab === "ship" ? html`<${AddonCards} repoId=${repoId} branch=${status.branch} version=${tab + ":" + (runner.job && runner.job.state !== "running" ? runner.job.id : "")} />` : null}
          ${tab === "start" ? html`<${StartTab} repoId=${repoId} status=${status} branches=${branches} runner=${runner} onContinue=${() => setTab("ship")} onSwitch=${switchTo} />` : null}
          ${tab === "ship" ? html`<${ShipTab} status=${status} runner=${runner} groups=${groups} setGroups=${setGroups} tested=${!!tested[key]} setTested=${v => setTested({ ...tested, [key]: v })} worktree=${worktree} onOpenFile=${openFile} />` : null}
          ${tab === "deploy" ? html`<${DeployTab} repoId=${repoId} status=${status} branches=${branches} runner=${runner} onError=${fail} confirm=${confirm} />` : null}
          ${tab === "release" ? html`<${ReleaseTab} repoId=${repoId} status=${status} branches=${branches} runner=${runner} onError=${fail} onLoaded=${() => reload()} onSettings=${() => setDialog("settings")} onCopy=${copy} onPullRequest=${releasePullRequest} />` : null}
` : html`<p class="hint">Loading…</p>`}
      </aside></main>`}

    <footer class="credit"><span>${versionLine(serverVersion)}</span><span aria-hidden="true">·</span><span>by <${ExternalLink} href=${LINKS.website.href}>${AUTHOR_SHORT}<//></span><span aria-hidden="true">·</span><button type="button" class="link" onClick=${() => { setAboutAuto(false); setDialog("about"); }}>About</button></footer>
    ${dialog === "about" ? html`<${AboutDialog} version=${serverVersion} auto=${aboutAuto} notify=${notify} notice=${notice} onNotice=${setNotice} onClose=${() => setDialog(null)} />` : null}
    ${dialog === "add" ? html`<${AddRepoDialog} onAdd=${addRepo} onClose=${() => setDialog(null)} />` : null}
    ${dialog === "settings" && status ? html`<${SettingsDialog} status=${status} branches=${branches} repoName=${repo ? repo.name : ""} onSave=${saveSettings} onRemove=${removeRepo} onClose=${() => setDialog(null)} />` : null}
    ${modalView()}
    ${menu ? html`<${ContextMenu} menu=${menu} onClose=${() => setMenu(null)} />` : null}
    ${pending && pending.ask ? html`<${BranchHereDialog} commit=${pending.commit} templates=${branchTemplates(status, branches, new Date())} onClose=${() => setPending(null)} onSubmit=${(name, publish) => preview("branch", { name, commit: pending.commit.sha, push: publish }, "Create branch " + name, publish ? "Create and push" : "Create branch")} />` : null}
    ${pending && pending.diverged ? html`<${DivergedDialog} state=${push} runner=${runner} onClose=${() => setPending(null)} />` : null}
    ${pending && !pending.ask && !pending.diverged ? html`<${ActionConfirm} pending=${pending} runner=${runner} onClose=${() => setPending(null)} />` : null}
    ${confirmRequest ? html`<${ConfirmDialog} request=${confirmRequest} onAnswer=${answer} />` : null}
    <${ToastHost} items=${toasts} queue=${queue} />
  </div>`;
}

// the settings come back into the storage before anything reads them (a new address, another port, has an empty storage)
syncStorage().catch(() => {}).finally(() => {
  try { document.documentElement.setAttribute("data-theme", currentTheme(localStorage, window.matchMedia.bind(window))); } catch (e) { /* the theme of the first paint stays */ }
  render(html`<${App} />`, document.getElementById("app"));
});
