import assert from "node:assert";
import { OPS, filterActions, formProblem, history, initialValues, lineFrom, menuItems, pushedShas, reasonOf, shortcutFor, SHORTCUTS, syncPlan, validBranchName, commitMenuIds, branchMenuIds } from "../../ui/shuttle_ui/static/js/ops.js";
import { activeFilters, dayLabel, durationText, historyQuery, loadFilters, matchesFilters, mergePage, relative, saveFilters, sinceDate, withDays } from "../../ui/shuttle_ui/static/js/logview.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const commit = (sha, parents, refs = []) => ({ sha, parents, refs, subject: sha });
const commits = [commit("d", ["c"], ["HEAD -> feat"]), commit("c", ["b"]), commit("b", ["a"], ["origin/feat"]), commit("a", [])];
const map = new Map(commits.map(c => [c.sha, c]));
const status = (o = {}) => ({ branch: "feat", protected: "0", staged: "0", unstaged: "0", untracked: "0", upstream: "origin/feat", "upstream.ahead": "0", "upstream.behind": "0", "integration.ref": "origin/staging", "integration.behind": "0", operation: "", stash: "0", ...o });
const ctx = (o = {}) => ({ status: status(), busy: false, branches: { local: [], remote: [] }, commits: map, headSha: "d", pushed: pushedShas(commits, ["origin"]), ...o });

t("pushedShas: a commit a remote branch reaches, and its ancestors", () => {
  assert.deepStrictEqual([...pushedShas(commits, ["origin"])].sort(), ["a", "b"]);
  assert.deepStrictEqual([...pushedShas(commits, [])], []);
});
t("lineFrom follows the first parents from the tip, oldest first", () => {
  assert.deepStrictEqual(lineFrom(ctx(), "b").map(c => c.sha), ["b", "c", "d"]);
  assert.strictEqual(lineFrom(ctx(), "zzz"), null);
});
t("history: only commits that nobody has can be rewritten", () => {
  assert.strictEqual(history(ctx(), "c"), "");
  assert.match(history(ctx(), "b"), /on a remote/);
  assert.match(history(ctx(), "zzz"), /not on the branch/);
  assert.match(history(ctx({ commits: new Map([...map, ["c", commit("c", ["b", "x"])]]) }), "c"), /merge commit/);
});
t("every action has a reason function that never throws, and an answer for a bare context", () => {
  for (const id of Object.keys(OPS)) assert.doesNotThrow(() => reasonOf(id, ctx(), { commit: commits[1], branch: { name: "x", ref: "refs/heads/x", upstream: "", ahead: 0, behind: 0 }, name: "x", way: "up" }), id);
  assert.strictEqual(reasonOf("nothing", ctx()), "unknown action");
});
t("the same refusals as the command line, before asking", () => {
  const c = ctx(), a = { commit: commits[1] };
  assert.strictEqual(reasonOf("amend", c, { commit: commits[0] }), "");
  assert.match(reasonOf("amend", c, a), /only the last commit/);
  assert.match(reasonOf("drop", c, { commit: commits[2] }), /on a remote/);
  assert.match(reasonOf("revert", ctx({ status: status({ protected: "1" }) }), a), /protected/);
  assert.match(reasonOf("revert", ctx({ status: status({ unstaged: "2" }) }), a), /commit or stash/);
  assert.match(reasonOf("drop", ctx({ status: status({ operation: "rebase" }) }), a), /finish the rebase/);
  assert.match(reasonOf("drop", ctx({ status: status({ operation: "am" }) }), a), /finish the patch/);
  assert.match(reasonOf("pull", ctx({ status: status({ upstream: "" }) })), /no upstream/);
  assert.match(reasonOf("push-force", ctx({ busy: true })), /running/);
  assert.match(reasonOf("stash", ctx()), /nothing to stash/);
  assert.strictEqual(reasonOf("stash", ctx({ status: status({ untracked: "1" }) })), "");
  assert.match(reasonOf("stash-pop", ctx()), /empty/);
  assert.match(reasonOf("undo", ctx()), /nothing to undo/);
  assert.strictEqual(reasonOf("undo", ctx({ status: status({ "journal.undo": "commit" }) })), "");
  assert.match(reasonOf("reset", ctx(), { commit: commits[0] }), /already here/);
  assert.match(reasonOf("sync", ctx({ status: status({ "integration.ref": "" }) })), /integration/);
  assert.match(reasonOf("update-branch", ctx(), { branch: { current: false, upstream: "o/x", behind: 0, ahead: 0 } }), /up to date/);
  assert.match(reasonOf("update-branch", ctx(), { branch: { current: false, upstream: "o/x", behind: 2, ahead: 1 } }), /commits of its own/);
  assert.strictEqual(reasonOf("update-branch", ctx(), { branch: { current: false, upstream: "o/x", behind: 2, ahead: 0 } }), "");
});
t("requests carry exactly what the server validates", () => {
  const c = ctx({ status: status({ "journal.undo": "commit" }) });
  assert.deepStrictEqual(OPS.reset.request(c, { commit: commits[1] }, { mode: "hard", confirm_branch: "feat" }).params, { mode: "hard", commit: "c", confirm_branch: "feat" });
  assert.deepStrictEqual(OPS.reset.request(c, { commit: commits[1] }, { mode: "soft", confirm_branch: "x" }).params, { mode: "soft", commit: "c" });
  assert.strictEqual(OPS.reset.request(c, { commit: commits[1] }, { mode: "hard", confirm_branch: "feat" }).tone, "destructive");
  assert.deepStrictEqual(OPS.rename.request(c, { branch: { name: "a" } }, { new: " b ", remote: true }).params, { old: "a", new: "b", remote: true });
  assert.deepStrictEqual(OPS.upstream.request(c, { branch: { name: "a" } }, { set: "" }).params, { name: "a", unset: true });
  assert.deepStrictEqual(OPS.upstream.request(c, { branch: { name: "a" } }, { set: "origin/a" }).params, { name: "a", set: "origin/a" });
  assert.deepStrictEqual(OPS.tag.request(c, { commit: commits[1] }, { name: "v1", message: " ", push: false }).params, { name: "v1", commit: "c", push: false });
  assert.deepStrictEqual(OPS.stash.request(c, {}, { message: "", untracked: true }).params, { sub: "push", untracked: true });
  assert.deepStrictEqual(OPS["stash-pop"].request(c).params, { sub: "pop", index: 0 });
  assert.deepStrictEqual(OPS["update-branch"].request(c, { branch: { name: "x" } }).params, { mode: "ff", branch: "x" });
  assert.deepStrictEqual(OPS["merge-in"].request(c, { name: "x" }, { mode: "" }).params, { name: "x" });
  assert.strictEqual(OPS.undo.request(c).label, "Undo commit");
  assert.strictEqual(OPS.delete.request(c, { branch: { name: "x" } }, { force: false }).tone, "destructive");
});
t("forms: required, typed confirmation, names, absolute paths", () => {
  const fields = OPS.reset.form(ctx(), { commit: commits[1] });
  assert.strictEqual(initialValues(fields).mode, "mixed");
  assert.match(formProblem([{ name: "a", label: "Name", required: true }], { a: "  " }), /required/);
  assert.match(formProblem([{ name: "c", label: "C", type: "typed", expect: "feat" }], { c: "fea" }), /type feat/);
  assert.strictEqual(formProblem([{ name: "c", label: "C", type: "typed", expect: "feat" }], { c: "feat" }), "");
  assert.match(formProblem([{ name: "b", label: "Branch", branchName: true }], { b: "a..b" }), /not a valid/);
  assert.match(formProblem([{ name: "p", label: "Path", absolute: true }], { p: "x/y" }), /absolute/);
  for (const ok of ["feature/x", "v1.2.3", "a_b-c"]) assert.ok(validBranchName(ok), ok);
  for (const bad of ["-x", "a..b", "a b", "x/", "/x", "x.lock", "a//b", "a;b", ""]) assert.ok(!validBranchName(bad), bad);
});
t("menus: a commit and a branch offer their actions with reasons", () => {
  const items = menuItems(ctx(), commitMenuIds(commits[1], [{ kind: "tag", name: "v1" }]), { commit: commits[1] });
  const ids = items.filter(i => i !== "-").map(i => i.id);
  for (const id of ["cherry-pick", "revert", "branch", "tag", "untag", "reset", "switch-detach", "amend", "drop", "move", "rewrite", "compare", "patch-create", "link"]) assert.ok(ids.includes(id), id);
  assert.strictEqual(items.find(i => i.label === "Delete tag v1").args.tag, "v1");
  const here = { name: "feat", ref: "refs/heads/feat", current: true, upstream: "origin/feat", ahead: 0, behind: 0 };
  const own = menuItems(ctx(), branchMenuIds(here), {}).filter(i => i !== "-").map(i => i.id);
  for (const id of ["pull", "pull-rebase", "pull-merge", "sync", "sync-merge", "rename", "upstream", "compare", "delete"]) assert.ok(own.includes(id), id);
  assert.ok(!own.includes("merge-in") && !own.includes("update-branch"), "the branch you are on is not merged into itself");
  const other = menuItems(ctx(), branchMenuIds({ ...here, name: "x", ref: "refs/heads/x", current: false }), {}).filter(i => i !== "-").map(i => i.id);
  for (const id of ["switch", "update-branch", "merge-in", "rebase-on", "delete"]) assert.ok(other.includes(id), id);
  const remote = menuItems(ctx(), branchMenuIds({ name: "origin/x", ref: "refs/remotes/origin/x" }), {});
  assert.ok(remote.some(i => i.id === "delete-remote" && i.args.name === "x"));
});
t("filterActions: all the words, in the label, group or command; blocked ones last", () => {
  const list = [{ label: "Push", group: "Sync", cli: "git shuttle push" }, { label: "Pull and rebase", group: "Sync", cli: "git shuttle pull --rebase", reason: "x" }, { label: "Stash changes", group: "Changes", cli: "git shuttle stash" }];
  assert.deepStrictEqual(filterActions(list, "").map(e => e.label), ["Push", "Stash changes", "Pull and rebase"]);
  assert.deepStrictEqual(filterActions(list, "pu").map(e => e.label), ["Push", "Pull and rebase"]);
  assert.deepStrictEqual(filterActions(list, "git shuttle stash").map(e => e.label), ["Stash changes"]);
  assert.deepStrictEqual(filterActions(list, "sync rebase").map(e => e.label), ["Pull and rebase"]);
  assert.deepStrictEqual(filterActions(list, "zzz"), []);
});
t("syncPlan: the one button does what is next", () => {
  assert.strictEqual(syncPlan({ status: null }).id, "fetch");
  assert.strictEqual(syncPlan({ status: status({ operation: "rebase" }) }).id, "continue");
  assert.strictEqual(syncPlan({ status: status({ upstream: "" }) }).label, "Publish");
  assert.strictEqual(syncPlan({ status: status({ "upstream.behind": "2", "upstream.ahead": "1" }) }).id, "pull-rebase");
  assert.strictEqual(syncPlan({ status: status({ "upstream.behind": "2" }) }).label, "Pull ↓2");
  assert.strictEqual(syncPlan({ status: status({ "upstream.ahead": "3" }) }).label, "Push ↑3");
  assert.strictEqual(syncPlan({ status: status({ "integration.behind": "4" }) }).id, "sync");
  assert.strictEqual(syncPlan({ status: status({ "integration.behind": "4", protected: "1" }) }).id, "fetch");
  assert.strictEqual(syncPlan({ status: status() }).id, "fetch");
});
t("shortcuts: with modifiers anywhere, plain keys never while typing", () => {
  const e = (key, o = {}, tag = "BODY") => ({ key, target: { tagName: tag }, ...o });
  assert.strictEqual(shortcutFor(e("k", { ctrlKey: true }, "INPUT")), "palette");
  assert.strictEqual(shortcutFor(e("f", { metaKey: true })), "search");
  assert.strictEqual(shortcutFor(e("b")), "branch");
  assert.strictEqual(shortcutFor(e("b", {}, "INPUT")), "");
  assert.strictEqual(shortcutFor(e("z", { ctrlKey: true })), "undo");
  assert.strictEqual(shortcutFor(e("Z", { ctrlKey: true, shiftKey: true })), "redo");
  assert.strictEqual(shortcutFor(e("z", { ctrlKey: true }, "TEXTAREA")), "", "the field keeps its own undo");
  assert.strictEqual(shortcutFor(e("?", { shiftKey: true })), "shortcuts");
  assert.strictEqual(shortcutFor(e("F", { shiftKey: true })), "fetch");
  assert.strictEqual(shortcutFor(e("b", { altKey: true })), "");
  assert.strictEqual(shortcutFor(e("x")), "");
  const ids = SHORTCUTS.filter(s => s.id).map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, "one shortcut per action");
});
t("log: days, relative times, durations", () => {
  const now = new Date(2026, 9, 21, 12);
  assert.strictEqual(dayLabel("2026-10-21T08:00:00", now), "Today");
  assert.strictEqual(dayLabel("2026-10-20T08:00:00", now), "Yesterday");
  assert.strictEqual(dayLabel("2026-10-01T08:00:00", now), "2026-10-01");
  const rows = withDays([{ time: "2026-10-21T10:00:00", id: 3 }, { time: "2026-10-21T09:00:00", id: 2 }, { time: "2026-10-20T09:00:00", id: 1 }], now);
  assert.deepStrictEqual(rows.map(r => r.separator || r.id), ["Today", 3, 2, "Yesterday", 1]);
  assert.strictEqual(relative("2026-10-21T11:59:30", new Date(2026, 9, 21, 12).getTime()), "just now");
  assert.strictEqual(relative("garbage"), "");
  assert.strictEqual(durationText(0.25), "250 ms"); assert.strictEqual(durationText(2.34), "2.3 s"); assert.strictEqual(durationText(125), "2 min 5 s"); assert.strictEqual(durationText(null), "");
});
t("log: filters become a query, are remembered (but not the text), and match live entries", () => {
  const f = { repo: "alpha", action: "push", result: "failed", q: "a b", range: "" };
  assert.strictEqual(historyQuery(f, 70), "limit=50&before=70&repo=alpha&action=push&result=failed&q=a+b");
  assert.strictEqual(historyQuery({ repo: "", action: "", result: "", q: "", range: "" }), "limit=50");
  assert.strictEqual(sinceDate("today", new Date(2026, 9, 21)), "2026-10-21"); assert.strictEqual(sinceDate("week", new Date(2026, 9, 21)), "2026-10-15"); assert.strictEqual(sinceDate("", new Date()), "");
  assert.strictEqual(activeFilters(f), 4);
  const s = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
  saveFilters(s, f);
  assert.deepStrictEqual(loadFilters(s), { repo: "alpha", action: "push", result: "failed", q: "", range: "" });
  assert.deepStrictEqual(loadFilters({ getItem: () => "{not json" }).result, "");
  assert.strictEqual(loadFilters({ getItem: () => JSON.stringify({ result: "weird", range: "year" }) }).result, "");
  assert.ok(matchesFilters({ repo: "alpha", action: "push", state: "failed", label: "x", commands: [] }, { ...f, q: "" }));
  assert.ok(!matchesFilters({ repo: "beta", action: "push", state: "failed" }, f));
  assert.ok(matchesFilters({ repo: "a", action: "p", state: "done", label: "Stage nothing", commands: [] }, { repo: "", action: "", result: "", q: "NOTHING", range: "" }));
  assert.deepStrictEqual(mergePage([{ id: 3 }, { id: 2 }], [{ id: 2 }, { id: 1 }]).map(e => e.id), [3, 2, 1]);
});
console.log("  " + n + " passed, 0 failed");
