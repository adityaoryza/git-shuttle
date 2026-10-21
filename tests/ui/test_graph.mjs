import assert from "node:assert";
import { layout, parseRefs, relativeTime } from "../../ui/shuttle_ui/static/js/graph.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const c = (sha, ...parents) => ({ sha, parents });

t("a straight line stays in one column", () => {
  const { rows, width } = layout([c("c", "b"), c("b", "a"), c("a")]);
  assert.deepStrictEqual(rows.map(r => r.col), [0, 0, 0]);
  assert.strictEqual(width, 1);
  assert.deepStrictEqual(rows[0].forks, [0]);
  assert.deepStrictEqual(rows[2].forks, []);
});
t("a branch that merges back takes a second column and joins", () => {
  //  m (merge of f and a2)    f is on a feature branch from a1
  const { rows, width } = layout([c("m", "a2", "f"), c("f", "a1"), c("a2", "a1"), c("a1")]);
  assert.strictEqual(width, 2);
  assert.deepStrictEqual(rows[0].forks.sort(), [0, 1]);
  assert.strictEqual(rows[1].col, 1);
  assert.strictEqual(rows[2].col, 0);
  assert.deepStrictEqual(rows[2].forks, [1], "the main line bends into the lane that already waits for the ancestor");
  assert.strictEqual(rows[3].col, 1);
  assert.deepStrictEqual(rows[3].joins, [1]);
});
t("two tips on one parent: the second bends into the first lane and its column is free again", () => {
  const { rows } = layout([c("x", "r"), c("y", "r"), c("r"), c("z", "r2"), c("r2")]);
  assert.strictEqual(rows[1].col, 1);
  assert.deepStrictEqual(rows[1].forks, [0]);
  assert.deepStrictEqual(rows[2].joins, [0]);
  assert.strictEqual(rows[3].col, 0, "the lanes are empty after the root, so the next tip starts at column 0");
});
t("every parent is reachable: lanes below a row hold its parents", () => {
  const commits = [c("m", "p", "q"), c("p", "z"), c("q", "z"), c("z")];
  const { rows } = layout(commits);
  assert.ok(rows[0].below.includes("p") && rows[0].below.includes("q"));
});
t("empty input and root commits", () => {
  assert.deepStrictEqual(layout([]).rows, []);
  assert.strictEqual(layout([c("only")]).rows[0].col, 0);
});
t("parseRefs: current branch, remote, tag, remote HEAD", () => {
  const refs = parseRefs(["HEAD -> feature/x", "origin/main", "origin/HEAD", "tag: v1.0", "main"], ["origin"]);
  assert.deepStrictEqual(refs, [
    { name: "feature/x", kind: "local", current: true },
    { name: "origin/main", kind: "remote", current: false },
    { name: "v1.0", kind: "tag", current: false },
    { name: "main", kind: "local", current: false },
  ]);
  assert.strictEqual(parseRefs(["origin/x"], []).at(0).kind, "local", "without that remote name it is a local branch with a slash");
  assert.deepStrictEqual(parseRefs(["HEAD"], []), [{ name: "HEAD", kind: "head", current: true }]);
});
t("relativeTime", () => {
  assert.strictEqual(relativeTime(1000, 1030), "just now");
  assert.strictEqual(relativeTime(0, 7200), "2h ago");
  assert.strictEqual(relativeTime(0, 86400 * 3), "3d ago");
  assert.strictEqual(relativeTime(5000, 1000), "just now");
});
console.log("  " + n + " passed, 0 failed");
