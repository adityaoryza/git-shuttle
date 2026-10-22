import assert from "node:assert";
import { addPicks, filterMerges, movePick, parseSubject, patternRegex, pendingOf, releaseAction, releaseBranches, releaseNotes, removePicks } from "../../ui/shuttle_ui/static/js/release.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const merges = [
  { subject: "Merge branch 'feature/billing_rounding' into staging", date: "2026-10-20", commits: [
    { hash: "aaaaaaa111", subject: "[FIX] billing: round the invoice total", pending: true },
    { hash: "bbbbbbb222", subject: "[FEAT] billing: tax summary", pending: false }] },
  { subject: "Merge branch 'feature/checkout_coupon' into staging", date: "2026-10-18", commits: [
    { hash: "ccccccc333", subject: "[FEAT] checkout: coupons as a percentage", pending: true }] },
  { subject: "Merge branch 'feature/catalog_search' into staging", date: "2026-10-10", commits: [
    { hash: "ddddddd444", subject: "[ADD] catalog: tests for the search", pending: false }] },
];

t("filterMerges: no search and nothing hidden keeps everything", () => {
  assert.strictEqual(filterMerges(merges, "", false).length, 3);
});
t("filterMerges: the released ones can be hidden, and a merge with nothing left disappears", () => {
  const out = filterMerges(merges, "", true);
  assert.deepStrictEqual(out.map(m => m.commits.map(c => c.hash)), [["aaaaaaa111"], ["ccccccc333"]]);
});
t("filterMerges: the search looks in the message, the hash and the title of the merge", () => {
  assert.deepStrictEqual(filterMerges(merges, "coupon", false).map(m => m.commits.length), [1]);
  assert.deepStrictEqual(filterMerges(merges, "ccccccc", false).map(m => m.commits[0].hash), ["ccccccc333"]);
  assert.deepStrictEqual(filterMerges(merges, "billing_rounding", false)[0].commits.length, 2, "the title of the merge brings its commits");
});
t("filterMerges: every word has to match, case does not matter", () => {
  assert.strictEqual(filterMerges(merges, "BILLING round", false)[0].commits.length, 2);
  assert.strictEqual(filterMerges(merges, "billing coupon", false).length, 0);
  assert.strictEqual(filterMerges(merges, "   ", false).length, 3, "blank is no search");
});
t("pendingOf: the commits that can still be picked", () => {
  assert.deepStrictEqual(pendingOf(merges).map(c => c.hash), ["aaaaaaa111", "ccccccc333"]);
});
t("addPicks: appended in the order given, released ones and repeats left out", () => {
  const first = addPicks([], merges[0].commits);
  assert.deepStrictEqual(first, [{ hash: "aaaaaaa111", subject: "[FIX] billing: round the invoice total" }]);
  const next = addPicks(first, [...merges[0].commits, ...merges[1].commits]);
  assert.deepStrictEqual(next.map(p => p.hash), ["aaaaaaa111", "ccccccc333"]);
});
t("removePicks and movePick", () => {
  const picks = [{ hash: "a" }, { hash: "b" }, { hash: "c" }];
  assert.deepStrictEqual(removePicks(picks, ["b"]).map(p => p.hash), ["a", "c"]);
  assert.deepStrictEqual(movePick(picks, 0, 1).map(p => p.hash), ["b", "a", "c"]);
  assert.strictEqual(movePick(picks, 0, -1), picks, "an edge stays");
  assert.strictEqual(movePick(picks, 2, 1), picks);
});
t("patternRegex: the placeholders become numbers, the rest is literal", () => {
  const re = patternRegex("19.0-release/{yymmdd}-v1.{n}");
  assert.ok(re.test("19.0-release/261021-v1.0") && re.test("19.0-release/261021-v1.12"));
  assert.ok(!re.test("19x0-release/261021-v1.0"), "the dots are literal");
  assert.ok(!re.test("19.0-release/20261021-v1.0"), "{yymmdd} is six digits");
  assert.ok(!re.test("x19.0-release/261021-v1.0") && !re.test("19.0-release/261021-v1.0-extra"));
  assert.ok(patternRegex("release/{date}-v1.{n}").test("release/20261021-v1.3"));
  assert.strictEqual(patternRegex(""), null);
});
t("releaseBranches: only the ones made with the pattern, newest first, numbers as numbers", () => {
  const names = ["main", "master-release/261020-v1.1", "master-release/261022-v1.0", "master-release/261020-v1.10", "master-release/261020-v1.2", "feature/x", "master-release/261022-v1.0"];
  assert.deepStrictEqual(releaseBranches("master-release/{yymmdd}-v1.{n}", names), ["master-release/261022-v1.0", "master-release/261020-v1.10", "master-release/261020-v1.2", "master-release/261020-v1.1"]);
  assert.deepStrictEqual(releaseBranches("", names), []);
});
t("parseSubject: [TAG] module: summary", () => {
  assert.deepStrictEqual(parseSubject("[FIX] stock_onsite: adjust the list"), { module: "stock_onsite", summary: "adjust the list" });
  assert.deepStrictEqual(parseSubject("Merge branch 'x' into y"), { module: "Other", summary: "Merge branch 'x' into y" });
  assert.deepStrictEqual(parseSubject("[IMP] a: b: c"), { module: "a", summary: "b: c" });
});
t("releaseNotes: by module, in the order picked, with short hashes", () => {
  const notes = releaseNotes("master-release/261022-v1.0", [
    { hash: "aaaaaaa111", subject: "[FIX] billing: round the invoice total" },
    { hash: "ccccccc333", subject: "[FEAT] checkout: coupons" },
    { hash: "eeeeeee555", subject: "[FEAT] billing: tax summary" },
    { hash: "fffffff666", subject: "a commit without the shape" },
  ]);
  assert.strictEqual(notes, [
    "## Release master-release/261022-v1.0", "",
    "### `billing`", "- round the invoice total (aaaaaaa)", "- tax summary (eeeeeee)", "",
    "### `checkout`", "- coupons (ccccccc)", "",
    "### Other", "- a commit without the shape (fffffff)", "",
  ].join("\n"));
});
t("releaseAction: nothing picked makes an empty branch, picks make it with commits", () => {
  const one = [{ hash: "aaaaaaa111" }];
  assert.deepStrictEqual(releaseAction({ picked: [], target: "", name: "rel/1", push: true }), { action: "release", label: "Create the release branch (no commits yet)", params: { onto: "rel/1", empty: true, push: true } });
  const withCommits = releaseAction({ picked: one, target: "", name: "", push: false, strategy: "theirs" });
  assert.strictEqual(withCommits.label, "Create the release branch with 1 commit");
  assert.deepStrictEqual(withCommits.params, { onto: "auto", commits: ["aaaaaaa111"], push: false, strategy: "theirs" });
  assert.strictEqual(releaseAction({ picked: [...one, ...one], target: "", name: "x", push: true }).label, "Create the release branch with 2 commits");
});
t("releaseAction: picks onto a release branch that exists are appended; with none picked there is nothing to run", () => {
  const picked = [{ hash: "aaaaaaa111" }, { hash: "ccccccc333" }];
  const add = releaseAction({ picked, target: "rel/1", name: "x", push: true });
  assert.strictEqual(add.label, "Add 2 commits to rel/1");
  assert.deepStrictEqual(add.params, { onto: "rel/1", append: true, commits: ["aaaaaaa111", "ccccccc333"], push: true, strategy: undefined });
  assert.deepStrictEqual(releaseAction({ picked: [], target: "rel/1", name: "", push: true }), { action: null, label: "Add commits to rel/1", params: null });
});
console.log("  " + n + " passed, 0 failed");
