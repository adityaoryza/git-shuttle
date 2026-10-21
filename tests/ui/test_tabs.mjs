import assert from "node:assert";
import { existingBranch, hereOf, refusedForChanges, startPlan, suggestTab, whereLine, willDo } from "../../ui/shuttle_ui/static/js/tabs.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const status = (extra = {}) => ({ branch: "feature/x", protected: "0", staged: "0", unstaged: "0", untracked: "0", "integration.ahead": "0", "integration.behind": "0", "integration.ref": "origin/staging", merged: "0", ...extra });
const branches = { local: [{ name: "feature/taken" }, { name: "main" }], remote: [{ name: "origin/feature/remote_only" }, { name: "origin/main" }] };

t("hereOf: numbers from the status; no branch means detached", () => {
  const h = hereOf(status({ staged: "1", unstaged: "2", untracked: "4", "integration.ahead": "3" }));
  assert.deepStrictEqual([h.tracked, h.untracked, h.changes, h.ahead, h.detached], [3, 4, 7, 3, false]);
  assert.strictEqual(hereOf(status({ branch: "" })).detached, true);
  assert.strictEqual(hereOf(null).changes, 0);
});
t("suggestTab: integration branch → Start; a task with work → Ship", () => {
  assert.strictEqual(suggestTab(null), "start");
  assert.strictEqual(suggestTab(status({ protected: "1", unstaged: "5" })), "start", "on the integration branch you start, even with changes");
  assert.strictEqual(suggestTab(status({ unstaged: "7" })), "ship");
  assert.strictEqual(suggestTab(status({ untracked: "1" })), "ship");
  assert.strictEqual(suggestTab(status({ "integration.ahead": "2" })), "ship");
  assert.strictEqual(suggestTab(status({ "integration.ahead": "2", merged: "1" })), "start", "already merged: nothing to send");
  assert.strictEqual(suggestTab(status()), "start", "a task branch with nothing to send");
  assert.strictEqual(suggestTab(status({ operation: "rebase", protected: "1" })), "ship", "a rebase that waits is handled in the Ship tab");
});
t("existingBranch: local, remote only, or free", () => {
  assert.strictEqual(existingBranch("feature/taken", branches), "local");
  assert.strictEqual(existingBranch("feature/remote_only", branches), "remote");
  assert.strictEqual(existingBranch("feature/free", branches), null);
  assert.strictEqual(existingBranch("", branches), null);
  assert.strictEqual(existingBranch("x", null), null);
});
t("startPlan: the branch, the name that is taken, and whether a choice is needed", () => {
  const clean = startPlan({ status: status({ protected: "1" }), branches, name: "Keep dates", prefix: "feature/", choice: "stash" });
  assert.deepStrictEqual([clean.branch, clean.exists, clean.onTask, clean.needsChoice, clean.canCreate], ["feature/keep_dates", null, false, false, true]);
  assert.deepStrictEqual(clean.params, { name: "Keep dates" });
  const busy = startPlan({ status: status({ unstaged: "7" }), branches, name: "Next", prefix: "feature/", choice: "stash" });
  assert.deepStrictEqual([busy.onTask, busy.needsChoice], [true, true]);
  assert.deepStrictEqual(busy.params, { name: "Next", stash: true });
  assert.deepStrictEqual(startPlan({ status: status({ unstaged: "7" }), branches, name: "Next", choice: "carry" }).params, { name: "Next", carry: true });
  const taken = startPlan({ status: status(), branches, name: "taken", prefix: "feature/" });
  assert.deepStrictEqual([taken.exists, taken.canCreate], ["local", false]);
  assert.strictEqual(startPlan({ status: status(), branches, name: "remote only", prefix: "feature/" }).exists, "remote");
  assert.strictEqual(startPlan({ status: status(), branches, name: "!!!", prefix: "feature/" }).canCreate, false);
  assert.strictEqual(startPlan({ status: status({ operation: "merge" }), branches, name: "x", prefix: "feature/" }).canCreate, false);
  assert.deepStrictEqual(startPlan({ status: status({ untracked: "3" }), branches, name: "x" }).params, { name: "x" }, "new files do not need a choice");
});
t("whereLine and willDo say it in words", () => {
  assert.strictEqual(whereLine(hereOf(status({ unstaged: "6", untracked: "1", "integration.ahead": "2", "integration.behind": "1" }))), "You are on feature/x · ↑2 ↓1 vs origin/staging · 7 uncommitted changes");
  assert.strictEqual(whereLine(hereOf(status())), "You are on feature/x · ↑0 ↓0 vs origin/staging · no uncommitted changes");
  assert.strictEqual(whereLine(hereOf(status({ branch: "" }))), "You are not on a branch (detached HEAD).");
  assert.match(whereLine(hereOf(status({ untracked: "1" }))), /1 uncommitted change$/);
  const busy = hereOf(status({ unstaged: "2" }));
  assert.match(willDo(busy, "feature/y", "origin/staging", "stash"), /go to the stash first/);
  assert.match(willDo(busy, "feature/y", "origin/staging", "carry"), /come along/);
  assert.strictEqual(willDo(hereOf(status()), "feature/y", "origin/staging", "stash"), "The new branch is cut from origin/staging as feature/y.");
});
t("refusedForChanges: only a refused start because of changes", () => {
  const refused = { action: "start", ok: false, steps: [{ output: "error: the working tree has uncommitted changes: commit or stash them first" }] };
  assert.strictEqual(refusedForChanges(refused), true);
  assert.strictEqual(refusedForChanges({ ...refused, ok: true }), false);
  assert.strictEqual(refusedForChanges({ ...refused, action: "ship" }), false);
  assert.strictEqual(refusedForChanges({ action: "start", ok: false, steps: [{ output: "error: the branch 'x' already exists" }] }), false);
  assert.strictEqual(refusedForChanges(null), false);
});
console.log("  " + n + " passed, 0 failed");
