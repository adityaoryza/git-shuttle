import assert from "node:assert";
import { chainOf, chainToPick, commitNote, countsText, leftToPick, segments, taskRows, toRelease, totals } from "../../ui/shuttle_ui/static/js/task-release.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const zero = { prod: 0, release: 0, staging: 0, branch: 0, missing: 0 };
const done = { addon: "odoo-task", id: "16209", title: "Invoice numbering", branches: ["19.0-feature/numbering"], counts: { ...zero, prod: 8 }, commits: [] };
const half = { addon: "odoo-task", id: "17514", title: "Improvement 6 Nov", branches: ["19.0-feature/site_closed"], counts: { ...zero, prod: 3, staging: 4 },
  commits: [{ sha: "6b525f832a22", subject: "acl", state: "prod", match: "picked", as: "856b90180000" }, { sha: "ea3d6e66b659", subject: "site closed", state: "staging", match: "same", as: "ea3d6e66b659" },
    { sha: "10f08d6ce171", subject: "fr po", state: "staging", match: "patch", as: "22fb69dc0000" }] };
const gone = { addon: "odoo-task", id: "1", title: "Lost", branches: [], counts: { ...zero, missing: 2 }, commits: [] };
const data = { release: "19.0", integration: "19.0-staging", open: [], tasks: [half, done, gone] };

t("a task is to release when one of its commits is not in prod; a commit that is not here does not count", () => {
  assert.strictEqual(toRelease(half), true);
  assert.strictEqual(toRelease(done), false);
  assert.strictEqual(toRelease(gone), false);
  assert.strictEqual(toRelease({ counts: { ...zero, release: 1 } }), true, "on its way is not in prod yet");
});
t("To release keeps the tasks with work left, All keeps every task, and the filter reads the id, the title and the branches", () => {
  assert.deepStrictEqual(taskRows(data, "todo", "").map(r => r.id), ["17514"]);
  assert.deepStrictEqual(taskRows(data, "all", "").map(r => r.id), ["17514", "16209", "1"]);
  assert.deepStrictEqual(taskRows(data, "all", "numbering").map(r => r.id), ["16209"]);
  assert.deepStrictEqual(taskRows(data, "all", "SITE 17514").map(r => r.id), ["17514"], "every word, any case");
  assert.deepStrictEqual(taskRows(null, "all", ""), []);
});
t("the bar has one part per state with commits, in a fixed order, adding up to 100", () => {
  const parts = segments(half.counts);
  assert.deepStrictEqual(parts.map(p => p.state), ["prod", "staging"]);
  assert.strictEqual(Math.round(parts.reduce((s, p) => s + p.pct, 0)), 100);
  assert.deepStrictEqual(segments(zero), []);
  assert.deepStrictEqual(segments(undefined), []);
});
t("the bar says the same in words, for a screen reader", () => {
  assert.strictEqual(countsText(half.counts), "3 in prod, 4 not in prod");
  assert.strictEqual(countsText(zero), "no commit traced");
});
t("a commit says how it reached prod, or which release branch has it", () => {
  assert.match(commitNote(half.commits[0]), /^picked by hand as 856b9018/);
  assert.strictEqual(commitNote(half.commits[1]), "", "itself: nothing to add");
  assert.strictEqual(commitNote(half.commits[2]), "as 22fb69dc", "rebased before the merge: its hash on the integration branch");
  assert.strictEqual(commitNote({ state: "release", where: "19.0-release/261112-v1.0" }), "in 19.0-release/261112-v1.0");
  assert.match(commitNote({ state: "missing" }), /not in this repository/);
});
t("what is left to pick are the merged commits, under the hash the integration branch has", () => {
  assert.deepStrictEqual(leftToPick([half, done]).map(c => c.sha), ["ea3d6e66b659", "22fb69dc0000"]);
});
t("a task that needs another releases both, in the order of the integration branch", () => {
  const layout = { addon: "odoo-task", id: "15493", needs: [], needed_by: ["17553"], counts: { ...zero, staging: 2 },
    commits: [{ sha: "b37e022c", subject: "layout", state: "staging", as: "b37e022c", pos: 3 }, { sha: "019692c8", subject: "column", state: "staging", as: "019692c8", pos: 1 }] };
  const accent = { addon: "odoo-task", id: "17553", needs: ["15493", "404"], needed_by: [], counts: { ...zero, staging: 1, prod: 1 },
    commits: [{ sha: "c1014900", subject: "accent", state: "staging", as: "c1014900", pos: 7 }, { sha: "aaaa", subject: "old", state: "prod", as: "aaaa" }] };
  const loop = { ...layout, needs: ["17553"] };
  assert.deepStrictEqual(chainOf([accent, layout], accent).map(t => t.id), ["17553", "15493"], "a task that is not in the status is left out");
  assert.deepStrictEqual(chainOf([accent, loop], loop).map(t => t.id), ["15493", "17553"], "a loop is followed once");
  assert.deepStrictEqual(chainOf([accent, { ...layout, addon: "other" }], accent).map(t => t.id), ["17553"], "only tasks of the same add-on");
  assert.deepStrictEqual(chainToPick([accent, layout], accent).map(c => c.sha), ["019692c8", "b37e022c", "c1014900"]);
  assert.deepStrictEqual(chainToPick([accent, layout], layout).map(c => c.sha), ["019692c8", "b37e022c"], "the task it is needed by is not taken");
  assert.deepStrictEqual(chainToPick([half], half).map(c => c.sha), ["ea3d6e66b659", "22fb69dc0000"], "without pos the order of the trace stays");
});
t("the totals add the counts of the tasks shown", () => {
  assert.deepStrictEqual(totals([half, done]), { ...zero, prod: 11, staging: 4 });
  assert.deepStrictEqual(totals([]), zero);
});
console.log(n + " passed");
