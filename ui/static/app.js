/* git-shuttle UI: the screens. All text from the server or from git goes in through textContent (never innerHTML). */
(function () {
  "use strict";
  const L = window.ShuttleLogic;

  // ---- the token comes in the URL fragment, is kept in memory, and is removed from the address bar
  const TOKEN = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token") || "";
  try { history.replaceState(null, "", location.pathname); } catch (e) { /* not available */ }

  // ---- small helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === false || kid == null) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(method, path, body) {
    const headers = { "X-Shuttle-Token": TOKEN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch("/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  // ---- state
  const S = {
    view: "repos", repos: [], repoId: null, status: null, candidates: null, history: [],
    groups: [], how: "merge", pr: { title: "", body: "", draft: false }, tested: {},
    release: { name: "", push: true, picked: [], strategy: "" },
    startName: "", job: null, preview: null, modal: null, toastEl: null, loading: false,
  };
  const root = () => document.getElementById("app");

  function toast(message, kind) {
    if (S.toastEl && S.toastEl.remove) S.toastEl.remove();
    S.toastEl = h("div", { class: "toast " + (kind || "") }, message);
    document.body.append(S.toastEl);
    setTimeout(() => { if (S.toastEl && S.toastEl.remove) S.toastEl.remove(); }, 6000);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), "bad");

  const cfg = () => {
    const s = S.status || {};
    return {
      messagePattern: s["config.messagePattern"] || "", forbidTrailers: s["config.forbidTrailers"] || "",
      upgradeCommand: s["config.upgradeCommand"] || "", branchPrefix: s["config.branchPrefix"] || "",
      integration: s["config.integration"] || s["config.base"] || "", release: s["config.release"] || s["config.base"] || "",
    };
  };
  const repo = () => S.repos.find(r => r.id === S.repoId) || null;
  const testedKey = () => S.repoId + ":" + (S.status ? S.status.branch : "");

  // ---- data
  async function loadRepos() { S.repos = (await api("GET", "repos")).repos; }
  async function loadStatus() {
    S.status = (await api("GET", "repos/" + S.repoId + "/status")).status;
    rebuildGroups();
  }
  async function loadHistory() { S.history = (await api("GET", "history")).history; }

  function rebuildGroups() {
    const old = new Map(S.groups.map(g => [g.module, g]));
    const entries = (S.status && S.status.file) || [];
    const fresh = L.groupByModule(entries);
    const order = S.groups.map(g => g.module);
    fresh.sort((a, b) => {
      const ia = order.indexOf(a.module), ib = order.indexOf(b.module);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.module.localeCompare(b.module);
    });
    S.groups = fresh.map(g => {
      const prev = old.get(g.module);
      return Object.assign(g, {
        include: prev ? prev.include : true,
        message: prev ? prev.message : "[FEAT] " + (g.module === "(root)" ? "root" : g.module) + ": ",
      });
    });
  }

  // ---- screens
  function render() {
    const app = root();
    const tab = (id, label) => h("button", { class: S.view === id || (id === "repos" && S.view === "repo") ? "on" : "", onclick: () => go(id) }, label);
    // replaceChildren turns a null into the text "null": only real nodes go in
    app.replaceChildren(...[
      h("header", { class: "top" },
        h("h1", {}, "git-", h("span", {}, "shuttle")),
        h("nav", { class: "tabs" }, tab("repos", "Repositories"), tab("history", "History")),
        h("div", { class: "spacer" }),
        h("span", { class: "chip ok" }, "● 127.0.0.1")),
      h("main", {}, S.view === "repo" ? repoView() : S.view === "history" ? historyView() : reposView()),
      S.modal ? S.modal() : null].filter(Boolean));
  }

  async function go(view) {
    S.view = view;
    try {
      if (view === "repos") { await loadRepos(); }
      if (view === "history") { await loadHistory(); }
    } catch (e) { fail(e); }
    render();
  }

  // ----- repos
  function badge(st) {
    if (!st) return h("span", { class: "chip bad" }, "unreadable");
    if (st.operation) return h("span", { class: "chip bad" }, "stopped: " + st.operation);
    if (st["config.set"] === "0" && +st["integration.behind"] === 0 && +st.staged + +st.unstaged + +st.untracked === 0) return h("span", { class: "chip" }, "default settings");
    if (+st["integration.behind"] > 0 && st.protected !== "1") return h("span", { class: "chip warn" }, "needs sync");
    if (+st.staged + +st.unstaged + +st.untracked > 0) return h("span", { class: "chip warn" }, "changes pending");
    if (+st["integration.ahead"] > 0 && st.merged !== "1") return h("span", { class: "chip warn" }, "not shipped yet");
    return h("span", { class: "chip ok" }, "clean");
  }

  function reposView() {
    return h("div", {},
      h("div", { class: "row" },
        h("h2", {}, "Repositories ", h("span", { class: "muted" }, "· " + S.repos.length)),
        h("div", { class: "spacer" }),
        h("button", { class: "btn", onclick: refreshRepos }, "⟳ Refresh"),
        h("button", { class: "btn primary", onclick: addRepoModal }, "+ Add repository")),
      S.repos.length === 0 ? h("div", { class: "card" }, h("p", {}, "No repositories yet. Add one by its absolute path."), h("p", { class: "muted" }, "Example: /home/you/projects/my-repo")) : null,
      h("div", { class: "grid cards" }, S.repos.map(repoCard)));
  }

  function repoCard(r) {
    const st = r.status;
    return h("article", { class: "card" },
      h("div", { class: "head" }, h("h3", {}, r.name), badge(st)),
      h("div", { class: "path" }, r.path),
      r.error ? h("div", { class: "alert" }, r.error) : st ? h("dl", { class: "facts" },
        h("dt", {}, "branch"), h("dd", {}, (st.branch || "(detached)") + (st.protected === "1" ? "  · protected" : "")),
        h("dt", {}, "vs " + (st["integration.ref"] || "integrasi")), h("dd", {}, st["integration.ref"] ? "ahead " + st["integration.ahead"] + " · behind " + st["integration.behind"] : "-"),
        h("dt", {}, "tree"), h("dd", {}, st.staged + " staged · " + st.unstaged + " unstaged · " + st.untracked + " baru")) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => openRepo(r.id) }, "Open"),
        h("button", { class: "btn danger small", onclick: () => removeRepo(r) }, "Remove")));
  }

  async function refreshRepos() { try { await loadRepos(); render(); } catch (e) { fail(e); } }
  async function removeRepo(r) {
    if (!window.confirm("Remove " + r.name + " from the list? The repository itself is not deleted.")) return;
    try { await api("POST", "repos/" + r.id + "/remove", {}); await loadRepos(); render(); } catch (e) { fail(e); }
  }

  function addRepoModal() {
    const input = h("input", { type: "text", class: "mono", placeholder: "/home/you/projects/my-repo" });
    S.modal = () => modal("Add repository", [
      h("label", { class: "f" }, "Absolute path of a git repository"), input,
      h("p", { class: "muted" }, "Only repositories registered here can be acted on by this UI.")],
      async () => {
        try { await api("POST", "repos", { path: input.value.trim() }); S.modal = null; await loadRepos(); render(); } catch (e) { fail(e); }
      }, "Add");
    render();
  }

  function modal(title, body, onOk, okLabel) {
    return h("div", { class: "modal-bg" },
      h("div", { class: "modal" },
        h("h3", {}, title), h("div", {}, body),
        h("div", { class: "row" },
          h("div", { class: "spacer" }),
          h("button", { class: "btn", onclick: () => { S.modal = null; render(); } }, "Cancel"),
          onOk ? h("button", { class: "btn primary", onclick: onOk }, okLabel || "OK") : null)));
  }

  // ----- one repo
  async function openRepo(id) {
    S.repoId = id; S.view = "repo"; S.job = null; S.preview = null; S.candidates = null; S.groups = [];
    S.release = { name: "", push: true, picked: [], strategy: "" };
    try { await loadStatus(); } catch (e) { fail(e); }
    render();
  }

  async function reload() {
    try { await loadStatus(); await loadRepos(); } catch (e) { fail(e); }
    render();
  }

  function repoView() {
    const st = S.status;
    if (!st) return h("p", { class: "muted" }, "Loading…");
    const c = cfg();
    return h("div", {},
      h("div", { class: "row" },
        h("button", { class: "btn small", onclick: () => go("repos") }, "← Repositories"),
        h("h2", {}, (repo() || {}).name || "repo"),
        h("span", { class: "chip" }, "branch " + (st.branch || "(detached)")),
        st.protected === "1" ? h("span", { class: "chip warn" }, "protected") : null,
        h("div", { class: "spacer" }),
        h("button", { class: "btn small", onclick: fetchRepo }, "⟳ Fetch"),
        h("button", { class: "btn small", onclick: configModal }, "⚙ Settings")),
      operationBanner(st),
      st["config.set"] === "0" ? h("div", { class: "alert ok" }, h("b", {}, "Using the default settings"), "Integration: " + (c.integration || "?") + ", release: " + (c.release || "?") + ". Change them in ⚙ Settings if they differ (commit message rules, branch prefix, release name pattern).") : null,
      stepStart(st, c), stepWork(st, c), stepCommit(st, c), stepMerge(st, c), stepRelease(st, c),
      jobPanel());
  }

  async function fetchRepo() {
    try { const r = await api("POST", "repos/" + S.repoId + "/fetch", {}); toast(r.ok ? "Fetch complete" : "Fetch failed: " + r.output, r.ok ? "ok" : "bad"); await reload(); } catch (e) { fail(e); }
  }

  function operationBanner(st) {
    if (!st.operation) return null;
    return h("div", { class: "alert" },
      h("b", {}, "✗ Stopped: a " + st.operation + " is waiting to be finished"),
      "Nothing was forced and nothing was pushed. Resolve the conflicts in your editor, save, then continue.",
      st.conflict.length ? h("ul", { class: "list" }, st.conflict.map(f => h("li", {}, h("span", { class: "st U" }, "UU"), h("div", { class: "grow name" }, f)))) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => runAction("continue", {}, "Continue") }, "Mark resolved & continue"),
        h("button", { class: "btn danger", onclick: () => { if (window.confirm("Abort the " + st.operation + "? The repository returns to how it was before it started.")) runAction("abort", {}, "Abort"); } }, "Abort")),
      h("p", { class: "muted" }, "After continuing, run Ship again (without a new message) to finish the rest."));
  }

  function stepHead(n, title, subtitle) {
    return h("div", { class: "head" }, h("span", { class: "num" }, n), h("h3", {}, title), subtitle ? h("span", { class: "muted" }, subtitle) : null);
  }

  // 1. start a task: a branch from the integration branch
  function stepStart(st, c) {
    const prefix = c.branchPrefix || "feature/";
    const input = h("input", { type: "text", class: "mono", placeholder: "task name, e.g. keep manual order date", value: S.startName });
    const target = h("span", { class: "mono" }, L.branchFromName(S.startName, prefix) || "-");
    input.addEventListener("input", () => { S.startName = input.value; target.textContent = L.branchFromName(input.value, prefix) || "-"; });
    return h("section", { class: "card step" },
      stepHead(1, "Start a task", "one branch per task, from " + (c.integration || "integrasi")),
      h("div", { class: "row" }, input,),
      h("p", { class: "muted" }, "New branch: ", target, "  ·  from origin/" + (c.integration || "…")),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => previewAction("start", { name: S.startName }) }, "Preview"),
        h("button", { class: "btn primary", disabled: !L.branchFromName(S.startName, prefix), onclick: () => runAction("start", { name: S.startName }, "Start a task") }, "Create branch")));
  }

  // 2. work, then test in Odoo: the command is shown to be copied, never run
  function stepWork(st, c) {
    const files = (st.file || []).map(L.parseFileEntry);
    const cmd = L.upgradeCommand(c.upgradeCommand, S.groups.filter(g => g.module !== "(root)"));
    const key = testedKey();
    return h("section", { class: "card step" },
      stepHead(2, "Work & test", files.length + " changed files"),
      files.length ? h("ul", { class: "list" }, files.slice(0, 40).map(f => h("li", {}, h("span", { class: "st " + (f.untracked ? "q" : f.label) }, f.label), h("div", { class: "grow name" }, f.path)))) : h("p", { class: "muted" }, "No changes in the working tree."),
      files.length > 40 ? h("p", { class: "muted" }, "… and " + (files.length - 40) + " more files") : null,
      c.upgradeCommand ? h("div", {},
        h("label", { class: "f" }, "Test before pushing (the UI never runs this: copy it to your terminal)"),
        h("pre", { class: "out" }, cmd || c.upgradeCommand),
        h("div", { class: "row" },
          h("button", { class: "btn small", onclick: () => copyText(cmd || c.upgradeCommand) }, "Copy"),
          h("label", { class: "row" }, h("input", { type: "checkbox", checked: !!S.tested[key], onchange: (e) => { S.tested[key] = e.target.checked; render(); } }), "Tested (upgrade + UI)"))) : h("p", { class: "muted" }, "Set a test command in Settings to show it here."));
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied", "ok"); } catch (e) { toast("Copy it manually: no clipboard access", "bad"); }
  }

  // 3. one commit per module, in dependency order
  function stepCommit(st, c) {
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= S.groups.length) return; const t = S.groups[i]; S.groups[i] = S.groups[j]; S.groups[j] = t; render(); };
    return h("section", { class: "card step" },
      stepHead(3, "Commit by module", "order them by dependency: engine first, then UI, then per-module rules"),
      S.groups.length === 0 ? h("p", { class: "muted" }, "Nothing to commit. If the branch already has commits, go to step 4.") : null,
      S.groups.map((g, i) => groupBox(g, i, c, move)));
  }

  function groupBox(g, i, c, move) {
    const input = h("input", { type: "text", class: "mono", value: g.message, disabled: !g.include });
    const hint = h("div", { class: "hint" });
    const check = () => {
      g.message = input.value;
      const p = g.include ? L.messageProblem(g.message, c) : "";
      input.className = "mono " + (g.include ? (p ? "bad" : "good") : "");
      hint.className = "hint " + (g.include ? (p ? "bad" : "good") : "");
      hint.textContent = g.include ? (p ? "✗ " + p : "✓ follows the repository rules") : "not committed";
    };
    input.addEventListener("input", check); check();
    return h("div", { class: "group" },
      h("div", { class: "gh" },
        h("input", { type: "checkbox", checked: g.include, onchange: (e) => { g.include = e.target.checked; render(); } }),
        h("b", {}, g.module), h("span", { class: "muted" }, g.files.length + " files"),
        h("div", { class: "spacer" }),
        h("button", { class: "btn small", disabled: i === 0, onclick: () => move(i, -1) }, "▲"),
        h("button", { class: "btn small", disabled: i === S.groups.length - 1, onclick: () => move(i, 1) }, "▼")),
      h("div", { class: "files" }, g.files.map(f => h("div", {}, f.label + " " + f.path))),
      input, hint);
  }

  // 4. merge: a pull request, or a direct merge
  function mergeProblems(st) {
    const problems = [];
    const included = S.groups.filter(g => g.include);
    let blockers = (st.blocker || []).slice();
    if (included.length) blockers = blockers.filter(b => !b.startsWith("nothing to ship"));
    problems.push(...blockers);
    for (const g of included) { const p = L.messageProblem(g.message, cfg()); if (p) problems.push(g.module + ": " + p); }
    if (cfg().upgradeCommand && !S.tested[testedKey()]) problems.push("not marked as tested");
    if (S.how === "pr" && !(S.pr.title || (included[0] && included[0].message))) problems.push("the pull request title is empty");
    return problems;
  }

  function shipParams() {
    const included = S.groups.filter(g => g.include);
    const params = L.shipParams(S.groups, S.how === "pr" ? { pr: true, title: S.pr.title || (included[0] ? included[0].message.split("\n")[0] : ""), body: S.pr.body, draft: S.pr.draft } : null);
    const stage = L.pathsToStage(S.groups);
    if (stage.length) params.stage = stage;
    return params;
  }

  function stepMerge(st, c) {
    const problems = mergeProblems(st);
    const into = c.integration || "integrasi";
    return h("section", { class: "card step" },
      stepHead(4, "Merge", "sync → push → " + (S.how === "pr" ? "open a pull request" : "merge directly")),
      h("div", { class: "row" },
        h("label", { class: "row" }, h("input", { type: "radio", name: "how", checked: S.how === "merge", onchange: () => { S.how = "merge"; render(); } }), "Merge directly into " + into),
        h("label", { class: "row" }, h("input", { type: "radio", name: "how", checked: S.how === "pr", onchange: () => { S.how = "pr"; render(); } }), "Open a pull request to " + into)),
      S.how === "pr" ? h("div", {},
        h("label", { class: "f" }, "Pull request title (empty = first commit message)"),
        h("input", { type: "text", value: S.pr.title, oninput: (e) => { S.pr.title = e.target.value; } }),
        h("label", { class: "f" }, "Pull request description"),
        h("textarea", { oninput: (e) => { S.pr.body = e.target.value; } }, S.pr.body),
        h("label", { class: "row" }, h("input", { type: "checkbox", checked: S.pr.draft, onchange: (e) => { S.pr.draft = e.target.checked; } }), "Draft")) : null,
      problems.length ? h("div", { class: "alert warn" }, h("b", {}, "Cannot run yet"), h("ul", {}, problems.map(p => h("li", {}, p)))) : null,
      h("div", { class: "row" },
        h("button", { class: "btn", disabled: !!problems.filter(p => !p.startsWith("not marked")).length, onclick: () => previewAction("ship", shipParams()) }, "Preview (dry run)"),
        h("button", { class: "btn primary", disabled: !!problems.length || !previewFresh("ship", shipParams()), onclick: () => runAction("ship", shipParams(), "Ship") }, "Run"),
        !previewFresh("ship", shipParams()) ? h("span", { class: "muted" }, "Preview first (again after any change).") : null),
      S.preview && S.preview.action === "ship" ? previewBox() : null);
  }

  function previewBox() {
    const p = S.preview;
    return h("div", {},
      h("label", { class: "f" }, p.ok ? "Exactly what will run" : "Refused"),
      h("pre", { class: "out" }, p.steps.map(s => "# git shuttle " + s.argv.slice(0, 2).join(" ") + "\n" + s.output).join("\n")));
  }

  // 5. release
  async function loadCandidates() {
    try {
      await api("POST", "repos/" + S.repoId + "/fetch", {});
      S.candidates = (await api("GET", "repos/" + S.repoId + "/candidates")).candidates;
      await loadStatus();
      S.release.name = S.status["suggest.release"] || "auto";
      S.release.picked = [];
    } catch (e) { fail(e); }
    render();
  }

  function togglePick(c, commit, on) {
    if (on) S.release.picked.push({ hash: commit.hash, subject: commit.subject, from: c.subject });
    else S.release.picked = S.release.picked.filter(p => p.hash !== commit.hash);
    render();
  }

  function stepRelease(st, c) {
    const movePick = (i, d) => { const j = i + d; const a = S.release.picked; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); };
    const pickable = (S.candidates || []).slice().reverse();   // oldest merge first
    const params = () => ({ onto: S.release.name || "auto", commits: S.release.picked.map(p => p.hash), push: S.release.push, strategy: S.release.strategy || undefined });
    return h("section", { class: "card step" },
      stepHead(5, "Release", "release branch from origin/" + (c.release || "…") + ", commits picked in order"),
      S.candidates === null ? h("button", { class: "btn", onclick: loadCandidates }, "Load release candidates") : h("div", {},
        S.candidates.length === 0 ? h("p", { class: "muted" }, "No branch has been merged into " + (c.integration || "integrasi") + " since the last release.") : null,
        pickable.map(m => h("div", { class: "group" },
          h("div", { class: "gh" }, h("b", {}, m.subject), h("span", { class: "muted" }, (m.date || "").slice(0, 10))),
          m.commits.map(cm => h("label", { class: "row" },
            h("input", { type: "checkbox", disabled: !cm.pending, checked: S.release.picked.some(p => p.hash === cm.hash), onchange: (e) => togglePick(m, cm, e.target.checked) }),
            h("span", { class: "mono" }, L.shortHash(cm.hash) + " " + cm.subject), !cm.pending ? h("span", { class: "chip" }, "already released") : null)))),
        S.release.picked.length ? h("div", {},
          h("label", { class: "f" }, "Order on the release branch"),
          h("ul", { class: "list" }, S.release.picked.map((p, i) => h("li", {},
            h("span", { class: "st" }, i + 1), h("div", { class: "grow name" }, L.shortHash(p.hash) + " " + p.subject),
            h("button", { class: "btn small", onclick: () => movePick(i, -1) }, "▲"), h("button", { class: "btn small", onclick: () => movePick(i, 1) }, "▼")))),
          h("label", { class: "f" }, "Release branch name ('auto' uses the pattern from Settings)"),
          h("input", { type: "text", class: "mono", value: S.release.name, oninput: (e) => { S.release.name = e.target.value; } }),
          h("div", { class: "row" },
            h("label", { class: "row" }, h("input", { type: "checkbox", checked: S.release.push, onchange: (e) => { S.release.push = e.target.checked; } }), "Push the branch"),
            h("select", { onchange: (e) => { S.release.strategy = e.target.value; } },
              h("option", { value: "" }, "on conflict: stop and show"), h("option", { value: "theirs" }, "on conflict: take the picked commit (theirs)"), h("option", { value: "ours" }, "on conflict: keep the release branch (ours)"))),
          h("div", { class: "row" },
            h("button", { class: "btn", onclick: () => previewAction("release", params()) }, "Preview"),
            h("button", { class: "btn primary", disabled: !previewFresh("release", params()), onclick: () => runAction("release", params(), "Create release branch") }, "Create release branch")),
          S.preview && S.preview.action === "release" ? previewBox() : null) : null));
  }

  // ---- actions: preview first, then run; the job panel follows the run
  // A preview counts only for the exact request it was made for: change a message, and it has to be made again.
  function previewFresh(action, params) {
    return !!(S.preview && S.preview.ok && S.preview.key === JSON.stringify([action, params]));
  }

  async function previewAction(action, params) {
    try {
      const r = await api("POST", "repos/" + S.repoId + "/preview", { action, params });
      S.preview = { action, ok: r.ok, steps: r.steps, key: JSON.stringify([action, params]) };
      if (!r.ok) toast("Refused: see the preview box", "bad");
    } catch (e) { fail(e); }
    render();
  }

  async function runAction(action, params, label) {
    try {
      const r = await api("POST", "repos/" + S.repoId + "/run", { action, params });
      S.job = { id: r.job, label: label || action, state: "running", steps: [] };
      S.preview = null;
      render();
      pollJob(r.job);
    } catch (e) { fail(e); }
  }

  async function pollJob(id) {
    try {
      const job = (await api("GET", "jobs/" + id)).job;
      S.job = Object.assign(S.job || {}, job, { label: (S.job && S.job.label) || job.action });
      render();
      if (job.state === "running") { setTimeout(() => pollJob(id), 600); return; }
      await reload();
      toast(job.state === "done" ? "Done" : job.state === "stopped" ? "Stopped: something needs your attention" : "Failed", job.state === "done" ? "ok" : "bad");
    } catch (e) { fail(e); }
  }

  function jobPanel() {
    const j = S.job;
    if (!j) return null;
    return h("section", { class: "card step" },
      h("div", { class: "head" }, h("h3", {}, "Result: " + j.label), h("span", { class: "chip " + (j.state === "done" ? "ok" : j.state === "running" ? "" : "bad") }, j.state)),
      h("ul", { class: "timeline" }, (j.steps || []).map(s => h("li", {}, h("span", { class: "dot " + s.state }), h("code", {}, "git shuttle " + s.argv.slice(0, 2).join(" "))))),
      (j.steps || []).filter(s => s.output).map(s => h("pre", { class: "out" }, s.output)),
      j.state === "done" && j.action === "release" ? h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => openReleasePr() }, "Open a pull request to " + (cfg().release || "release"))) : null,
      j.state === "stopped" ? h("p", { class: "muted" }, "The repository was left mid-operation. Resolve it with the banner above.") : null);
  }

  function openReleasePr() {
    const c = cfg();
    const title = S.status && S.status.branch ? S.status.branch : "release";
    previewAction("pr", { base: c.release, title: title, body: "Release: " + title });
  }

  // ---- configuration
  function configModal() {
    const st = S.status || {};
    const f = {
      integration: st["config.integration"] || "", release: st["config.release"] || "", messagePattern: st["config.messagePattern"] || "",
      forbidTrailers: st["config.forbidTrailers"] || "", branchPrefix: st["config.branchPrefix"] || "", releasePattern: st["config.releasePattern"] || "",
      upgradeCommand: st["config.upgradeCommand"] || "",
    };
    const field = (key, label, hintText) => {
      const input = h("input", { type: "text", class: "mono", value: f[key] });
      input.addEventListener("input", () => { f[key] = input.value; });
      return h("div", {}, h("label", { class: "f" }, label), input, hintText ? h("div", { class: "hint muted" }, hintText) : null);
    };
    S.modal = () => modal("Repository settings", [
      field("integration", "Integration branch (staging)", "where feature branches are merged"),
      field("release", "Release branch", "releases start from here"),
      field("branchPrefix", "Task branch prefix", "e.g. feature/ or 2.0-feature/"),
      field("releasePattern", "Release branch name pattern", "{date}=YYYYMMDD, {yymmdd}, {n}=first free number"),
      field("messagePattern", "Commit message pattern (regex)", "e.g. ^\\[[A-Z]+\\] [^:]+: .+"),
      field("forbidTrailers", "Forbidden trailers", "e.g. Co-Authored-By"),
      field("upgradeCommand", "Test command (shown, never run)", "{modules} is replaced by the changed modules")],
      async () => { S.modal = null; render(); await runAction("init", Object.assign({}, f), "Settings"); }, "Save");
    render();
  }

  // ---- history
  function historyView() {
    return h("div", {},
      h("h2", {}, "Action history ", h("span", { class: "muted" }, "· on this machine only")),
      h("div", { class: "card" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Time", "Repository", "Action", "Result", "Commands"].map(t => h("th", {}, t)))),
        h("tbody", {}, S.history.map(e => h("tr", {},
          h("td", { class: "mono" }, (e.time || "").replace("T", " ")), h("td", {}, e.repo), h("td", {}, e.action),
          h("td", {}, h("span", { class: "chip " + (e.state === "done" ? "ok" : "bad") }, e.state)),
          h("td", { class: "mono" }, (e.commands || []).join(" · ")))))),
        S.history.length === 0 ? h("p", { class: "muted" }, "No actions yet.") : null));
  }

  // ---- start
  async function start() {
    try { await loadRepos(); } catch (e) { fail(e); }
    render();
  }
  window.__shuttle = { S, render, openRepo, go, start, loadCandidates, configModal, addRepoModal, previewAction, runAction, pollJob };   // for the smoke test
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
