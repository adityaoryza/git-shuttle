import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../../ui/shuttle_ui/static/js/logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };

t("slug matches the CLI", () => {
  assert.strictEqual(L.slug("Keep manual Order-Date, on confirmation!"), "keep_manual_order_date_on_confirmation");
  assert.strictEqual(L.slug("  --  "), "");
  assert.strictEqual(L.slug("Ünïcode & 123"), "n_code_123");
});
t("branchFromName: prefix, no double prefix, empty", () => {
  assert.strictEqual(L.branchFromName("My Task", "19.0-feature/"), "19.0-feature/my_task");
  assert.strictEqual(L.branchFromName("19.0-feature/already_prefixed", "19.0-feature/"), "19.0-feature/already_prefixed");
  assert.strictEqual(L.branchFromName("My Task", ""), "feature/my_task");
  assert.strictEqual(L.branchFromName("!!!", "x/"), "");
});
t("parseFileEntry: statuses", () => {
  assert.deepStrictEqual(L.parseFileEntry("A  a b.txt"), { code: "A ", path: "a b.txt", staged: true, untracked: false, unmerged: false, label: "A" });
  assert.strictEqual(L.parseFileEntry("?? new.txt").untracked, true);
  assert.strictEqual(L.parseFileEntry(" M x.py").staged, false);
  assert.strictEqual(L.parseFileEntry(" M x.py").label, "M");
  assert.strictEqual(L.parseFileEntry("UU c.py").unmerged, true);
  assert.strictEqual(L.parseFileEntry("R  new.py").staged, true);
});
t("groupByModule: first folder, root files together, sorted", () => {
  const g = L.groupByModule(["M  sale_documents/models/a.py", "A  sale_documents/tests/t.py", "?? custom_x/v.xml", " M README.md", "M  Z/zz.py"]);
  assert.deepStrictEqual(g.map(x => x.module), ["(root)", "custom_x", "sale_documents", "Z"]);
  assert.strictEqual(g.find(x => x.module === "sale_documents").files.length, 2);
  assert.deepStrictEqual(L.groupByModule([]), []);
});
t("messageProblem: empty, pattern, trailers, free messages", () => {
  const cfg = { messagePattern: "^\\[[A-Z]+\\] [^:]+: .+", forbidTrailers: "Co-Authored-By Signed-off-by" };
  assert.strictEqual(L.messageProblem("", cfg), "the message is empty");
  assert.strictEqual(L.messageProblem("   \n\n", cfg), "the message is empty");
  assert.match(L.messageProblem("no tag", cfg), /does not match/);
  assert.strictEqual(L.messageProblem("[FIX] sales: ok", cfg), "");
  assert.match(L.messageProblem("[FIX] sales: ok\n\nco-authored-by: A <a@b.c>", cfg), /not allowed/);
  assert.strictEqual(L.messageProblem("fixup! something", cfg), "");
  assert.strictEqual(L.messageProblem("Merge branch 'x'", cfg), "");
  assert.strictEqual(L.messageProblem("anything", {}), "");
  assert.strictEqual(L.messageProblem("anything", { messagePattern: "[" }), "", "a pattern the browser cannot read is left to the CLI");
  assert.strictEqual(L.messageProblem("# comment\n[FIX] a: b", cfg), "");
  assert.strictEqual(L.messageProblem("x", { forbidTrailers: "bad name! ok-1" }), "", "a trailer setting that is not a name is ignored");
});
t("upgradeCommand: {modules} filled, root ignored", () => {
  const groups = L.groupByModule(["M  a_mod/x.py", "M  b_mod/y.py", " M README.md"]);
  assert.strictEqual(L.upgradeCommand("odoo-bin -u {modules}", groups), "odoo-bin -u a_mod,b_mod");
  assert.strictEqual(L.upgradeCommand("", groups), "");
  assert.strictEqual(L.upgradeCommand("x {modules} {modules}", groups), "x a_mod,b_mod a_mod,b_mod");
});
t("shipParams: included groups in order, PR options", () => {
  const groups = [
    { module: "a", include: true, message: "[A] a: one", files: [{ path: "a/x" }, { path: "a/y z" }] },
    { module: "b", include: false, message: "[B] b: two", files: [{ path: "b/x" }] },
    { module: "c", include: true, message: "[C] c: three", files: [{ path: "c/x" }] },
  ];
  assert.deepStrictEqual(L.shipParams(groups, null), { commits: [{ message: "[A] a: one", paths: ["a/x", "a/y z"] }, { message: "[C] c: three", paths: ["c/x"] }] });
  const pr = L.shipParams(groups, { pr: true, title: "T", body: "B", draft: true });
  assert.strictEqual(pr.pr, true); assert.strictEqual(pr.title, "T"); assert.strictEqual(pr.body, "B"); assert.strictEqual(pr.draft, true);
  assert.strictEqual("title" in L.shipParams(groups, { pr: true }), false);
});
t("pathsToStage: untracked files of included groups only", () => {
  const g = L.groupByModule(["?? a/new.py", "M  a/old.py", "?? b/new.py"]).map(x => ({ ...x, include: x.module === "a" }));
  assert.deepStrictEqual(L.pathsToStage(g), ["a/new.py"]);
});
t("tagOf, shortHash", () => {
  assert.strictEqual(L.tagOf("[FIX] x: y"), "FIX"); assert.strictEqual(L.tagOf("no tag"), "");
  assert.strictEqual(L.shortHash("0123456789abcdef"), "0123456");
});
t("slug is the same as the CLI's branch_slug", () => {
  const samples = ["Keep manual Order-Date, on confirmation!", "  --  ", "Ünïcode & 123", "UPPER lower 9", "a__b", "x/y z", "tab\tname", "emoji 🚀 here", "---a---"];
  for (const s of samples) {
    const cli = execFileSync("bash", ["-c", 'source "$1/lib/commands/start.sh"; branch_slug "$2"', "x", ROOT, s]).toString();
    assert.strictEqual(L.slug(s), cli, JSON.stringify(s));
  }
});
t("branchOptions: local and remote merged, remote prefix removed, sorted", () => {
  const o = L.branchOptions({ local: [{ name: "main" }, { name: "19.0" }], remote: [{ name: "origin/main" }, { name: "origin/staging" }] });
  assert.deepStrictEqual(o, [{ name: "19.0", where: "local" }, { name: "main", where: "local + remote" }, { name: "staging", where: "remote" }]);
  assert.deepStrictEqual(L.branchOptions(null), []);
});
t("prefixOptions: the folders in use, with the slash", () => {
  const p = L.prefixOptions({ local: [{ name: "19.0-feature/a" }, { name: "19.0-feature/b" }, { name: "main" }, { name: "17.0-bugfix/x" }], remote: [] });
  assert.deepStrictEqual(p.map(x => x.name), ["17.0-bugfix/", "19.0-feature/"]);
});
t("matchOptions: starts-with first, then contains, empty query lists all", () => {
  const o = ["19.0-staging", "staging", "old-staging-x", "main"].map(name => ({ name }));
  assert.deepStrictEqual(L.matchOptions(o, "stag").map(x => x.name), ["staging", "19.0-staging", "old-staging-x"]);
  assert.strictEqual(L.matchOptions(o, "").length, 4);
  assert.deepStrictEqual(L.matchOptions(o, "zzz"), []);
  assert.strictEqual(L.matchOptions(o, "STAG").length, 3, "case does not matter");
});
t("normalizePrefix: a slash is added, empty stays empty", () => {
  assert.strictEqual(L.normalizePrefix("19.0-feature"), "19.0-feature/");
  assert.strictEqual(L.normalizePrefix("19.0-feature/"), "19.0-feature/");
  assert.strictEqual(L.normalizePrefix("  "), "");
});
t("inferReleasePattern: the newest existing release branch gives the pattern", () => {
  assert.strictEqual(L.inferReleasePattern(["19.0-release/261020-v1.1", "19.0-release/261021-v1.0", "main"]), "19.0-release/{yymmdd}-v1.{n}");
  assert.strictEqual(L.inferReleasePattern(["release/20260410-v1.2"]), "release/{date}-v1.{n}");
  assert.strictEqual(L.inferReleasePattern(["feature/20260410-v1.2", "main"]), "", "only branches that say release");
  assert.strictEqual(L.inferReleasePattern([]), "");
});
t("releasePreview: first free number, nesting, no {n}", () => {
  const now = new Date(2026, 9, 21);
  assert.deepStrictEqual(L.releasePreview("19.0-release/{yymmdd}-v1.{n}", [], now), { name: "19.0-release/261021-v1.0" });
  assert.deepStrictEqual(L.releasePreview("19.0-release/{yymmdd}-v1.{n}", ["19.0-release/261021-v1.0", "19.0-release/261021-v1.1"], now), { name: "19.0-release/261021-v1.2" });
  assert.deepStrictEqual(L.releasePreview("", [], now), { name: "release/20261021-v1.0" });
  assert.match(L.releasePreview("release/{date}", ["release/20261021"], now).error, /already exists/);
  assert.match(L.releasePreview("release/{date}-v1.{n}", ["release"], now).error, /do not nest/);
});
t("releasePreview gives what the CLI gives (same date, same free number, same refusals)", () => {
  const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
  const run = (script) => execFileSync("bash", ["-c", script], { cwd: tmp, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x.io", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x.io" } }).toString();
  const d = new Date(), pad = n => String(n).padStart(2, "0"), today = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  run(`git init -q -b main . && git commit -q --allow-empty -m x && git branch '19.0-release/${today.slice(2)}-v1.0' && git branch '19.0-release/${today.slice(2)}-v1.1'`);
  for (const pattern of ["19.0-release/{yymmdd}-v1.{n}", "release/{date}-v1.{n}", "r/{yymmdd}-{n}"]) {
    const cli = run(`git config shuttle.releasePattern '${pattern}'; source "${ROOT}/lib/core/output.sh"; source "${ROOT}/lib/core/config.sh"; source "${ROOT}/lib/core/git.sh"; source "${ROOT}/lib/commands/release.sh"; release_branch_name`);
    const names = run("git for-each-ref --format='%(refname:short)' refs/heads").split("\n").filter(Boolean);
    assert.strictEqual(L.releasePreview(pattern, names).name, cli, pattern);
  }
  execFileSync("rm", ["-rf", tmp]);
});
t("moduleOf: the first folder, or (root)", () => {
  assert.deepStrictEqual(["a/b/c.py", "README.md", "dir/x", "we ird/ü.txt", ""].map(L.moduleOf), ["a", "(root)", "dir", "we ird", "(root)"]);
  assert.deepStrictEqual(L.groupByModule([" M a/x.py", "?? README.md"]).map(g => g.module), ["(root)", "a"], "the groups use the same rule");
});
console.log("  " + n + " passed, 0 failed");
