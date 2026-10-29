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
  const g = L.groupByModule(["M  billing/models/a.py", "A  billing/tests/t.py", "?? catalog/v.xml", " M README.md", "M  Z/zz.py"]);
  assert.deepStrictEqual(g.map(x => x.module), ["(root)", "billing", "catalog", "Z"]);
  assert.strictEqual(g.find(x => x.module === "billing").files.length, 2);
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
  assert.strictEqual(L.upgradeCommand("make test MODULES={modules}", groups), "make test MODULES=a_mod,b_mod");
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
t("ghMissing: only when the status says so, and the message says what to do", () => {
  assert.strictEqual(L.ghMissing({ gh: "0" }), true);
  for (const status of [{ gh: "1" }, {}, null, undefined]) assert.strictEqual(L.ghMissing(status), false, JSON.stringify(status));
  assert.ok(L.GH_MISSING.text.includes("gh auth login") && L.GH_MISSING.text.includes("hosting site"));
});
t("conflictChoices: the two sides in words, or null when the server does not say", () => {
  const status = { "conflict.ours": "origin/develop", "conflict.ours.role": "what you rebase onto", "conflict.theirs": "feat/x", "conflict.theirs.role": "your own work, being replayed" };
  assert.deepStrictEqual(L.conflictChoices(status), { ours: { name: "origin/develop", role: "what you rebase onto" }, theirs: { name: "feat/x", role: "your own work, being replayed" } });
  for (const bad of [{}, null, undefined, { "conflict.ours": "a" }, { "conflict.theirs": "b" }]) assert.strictEqual(L.conflictChoices(bad), null, JSON.stringify(bad));
  assert.deepStrictEqual(L.conflictChoices({ "conflict.ours": "a", "conflict.theirs": "b" }).ours, { name: "a", role: "" });
});
t("the buttons of a conflict say which branch is kept and which is dropped", () => {
  const c = L.conflictChoices({ "conflict.ours": "origin/develop", "conflict.ours.role": "what you rebase onto", "conflict.theirs": "feat/x", "conflict.theirs.role": "your own work" });
  assert.strictEqual(L.keepLabel(c.theirs), "Keep feat/x");
  assert.ok(L.keepTitle(c.theirs, c.ours).includes("your own work") && L.keepTitle(c.theirs, c.ours).includes("what origin/develop wrote in it is dropped"));
  assert.strictEqual(L.conflictSidesLine(c), "origin/develop is what you rebase onto; feat/x is your own work.");
});
t("resolveRequest: the side, one file, and the name of the branch in the label", () => {
  const status = { "conflict.ours": "m1", "conflict.theirs": "m2" };
  assert.deepStrictEqual(L.resolveRequest(status, "theirs", "a/b.txt"), { action: "resolve", params: { side: "theirs", paths: ["a/b.txt"] }, label: "Keep m2 in a/b.txt", verb: "Keep m2" });
  assert.strictEqual(L.resolveRequest({}, "ours", "x").label, "Keep ours in x", "without the names of the branches it still works");
});
t("pickProgress: commit N of M, each commit with its state; null when no pick waits", () => {
  const step = (state, sha, subject) => [state, sha, subject, "Alex", "2 days ago"].join("\x1f");
  const status = { "pick.total": "3", "pick.index": "2", "pick.branch": "rel/x", "pick.base": "release", "pick.push": "1", "pick.mode": "pick",
    "pick.step": [step("done", "a".repeat(40), "one"), step("current", "b".repeat(40), "two"), step("todo", "c".repeat(40), "three")] };
  const p = L.pickProgress(status);
  assert.deepStrictEqual([p.index, p.total, p.branch, p.base, p.push, p.mode], [2, 3, "rel/x", "release", true, "pick"]);
  assert.deepStrictEqual(p.steps.map(s => s.state), ["done", "current", "todo"]);
  assert.strictEqual(p.current.subject, "two");
  assert.deepStrictEqual(L.parsePickStep(step("todo", "d", "x")), { state: "todo", sha: "d", subject: "x", author: "Alex", when: "2 days ago" });
  for (const none of [{}, null, undefined, { "pick.total": "0" }]) assert.strictEqual(L.pickProgress(none), null, JSON.stringify(none));
});
t("releaseReady: the release branch that waits for its pull request", () => {
  assert.deepStrictEqual(L.releaseReady({ "release.ready": "rel/x", "release.base": "release", "release.pushed": "1" }), { branch: "rel/x", base: "release", pushed: true });
  assert.strictEqual(L.releaseReady({ "release.ready": "rel/x", "release.pushed": "0" }).pushed, false);
  for (const none of [{}, null, undefined]) assert.strictEqual(L.releaseReady(none), null);
});
t("plainSide: the sides of a conflict get plain titles, and an unknown role keeps the name", () => {
  assert.deepStrictEqual(L.plainSide({ name: "origin/staging", role: "what you rebase onto" }).title, "What is already there");
  assert.strictEqual(L.plainSide({ name: "feat/x", role: "your own work, being replayed" }).title, "Your change");
  assert.strictEqual(L.plainSide({ name: "feat/x", role: "the branch you merge in" }).title, "The incoming branch");
  assert.strictEqual(L.plainSide({ name: "abc1234 a commit", role: "the commit you pick" }).title, "The picked commit");
  assert.strictEqual(L.plainSide({ name: "odd/name", role: "something new" }).title, "odd/name");
  assert.strictEqual(L.plainSide(null).title, "");
});
t("linkify: the web addresses of a text are pieces of their own, and only http and https", () => {
  const pieces = L.linkify("see https://hub.doodex.net/web#id=1&model=project.task, and (https://a.example/b). javascript:alert(1) ftp://x");
  assert.deepStrictEqual(pieces.filter(p => p.url).map(p => p.url), ["https://hub.doodex.net/web#id=1&model=project.task", "https://a.example/b"]);
  assert.strictEqual(pieces.map(p => p.text).join(""), "see https://hub.doodex.net/web#id=1&model=project.task, and (https://a.example/b). javascript:alert(1) ftp://x");
  assert.deepStrictEqual(L.linkify("no address"), [{ text: "no address" }]);
  assert.deepStrictEqual(L.linkify(""), []);
});
t("conflictCode and hasMarkers: only a file written on both sides has places to choose from", () => {
  const status = { file: ["UU a.txt", "AA b/c.txt", "DU gone.txt", " M other.txt"] };
  assert.deepStrictEqual(["a.txt", "b/c.txt", "gone.txt", "nope.txt"].map(f => L.conflictCode(status, f)), ["UU", "AA", "DU", ""]);
  assert.deepStrictEqual(["UU", "AA", "DU", "UD", ""].map(L.hasMarkers), [true, true, false, false, false]);
});
t("the places of a conflict: who changed your side, what a place can keep, when all are decided, the request", () => {
  assert.strictEqual(L.blameLine({ picked: 2, subject: "fix price", author: "Sam", when: "3 days ago", lines: 1 }, 7), "Commit 2 of 7 of this release: fix price (Sam, 3 days ago) · 1 line");
  assert.strictEqual(L.blameLine({ picked: null, subject: "hotfix", author: "", when: "", lines: 4 }, 7), "Already on the branch: hotfix · 4 lines");
  const sides = { ours: { name: "rel/x", role: "the branch you are on" }, theirs: { name: "abc1234 fix", role: "the commit you pick" } };
  assert.deepStrictEqual(L.hunkChoices(sides, false).map(c => c.id), ["ours", "theirs", "both", "both-reverse"]);
  assert.deepStrictEqual(L.hunkChoices(sides, true).map(c => c.id), ["ours", "theirs", "both", "both-reverse", "base"]);
  assert.strictEqual(L.hunkChoices(sides, false)[2].label, "Both, rel/x first");
  const hunks = [{ n: 1 }, { n: 2 }];
  assert.strictEqual(L.hunksDecided(hunks, { 1: "ours" }), false);
  assert.strictEqual(L.hunksDecided(hunks, { 1: "ours", 2: "both" }), true);
  assert.strictEqual(L.hunksDecided([], {}), false, "nothing to decide is not decided");
  assert.deepStrictEqual(L.resolveHunksRequest("a/b.txt", { 1: "ours", 2: "theirs" }),
    { action: "resolve", params: { file: "a/b.txt", hunks: { 1: "ours", 2: "theirs" } }, label: "Resolve a/b.txt, place by place", verb: "Write the choices" });
});
t("branchTemplates: the prefix of the settings, the prefixes in use, the next release name", () => {
  const branches = { local: [{ name: "19.0-feature/a" }, { name: "19.0-fix/b" }, { name: "main" }], remote: [{ name: "origin/19.0-release/261021-v1.0" }, { name: "origin/19.0-hotfix/c" }] };
  const status = { "config.branchPrefix": "19.0-feature/", "config.releasePattern": "19.0-release/{yymmdd}-v1.{n}" };
  const now = new Date(2026, 9, 23);
  const t2 = L.branchTemplates(status, branches, now);
  assert.deepStrictEqual(t2.map(t => t.value), ["19.0-feature/", "19.0-fix/", "19.0-hotfix/", "19.0-release/", "19.0-release/261023-v1.0"]);
  assert.deepStrictEqual(t2.map(t => t.kind), ["prefix", "prefix", "prefix", "prefix", "release"]);
  assert.strictEqual(L.branchTemplates({}, { local: [{ name: "main" }] }, now).length, 0, "no settings and no prefix in use: nothing to offer");
  const inferred = L.branchTemplates({}, { remote: [{ name: "origin/release/261021-v1.0" }] }, now);
  assert.ok(inferred.some(t => t.kind === "release" && t.value === "release/261023-v1.0"), "the release pattern is read from the release branches that exist");
  assert.ok(L.branchTemplates(status, branches, now).length <= 6);
  assert.deepStrictEqual(L.branchTemplates(null, undefined, now), []);
});
t("shortName: a long name is cut for a button, a short one stays", () => {
  assert.strictEqual(L.shortName("feat/x"), "feat/x");
  const cut = L.shortName("251fa0e [FEAT] price: first revision of the task");
  assert.ok(cut.length <= 32 && cut.endsWith("…") && cut.startsWith("251fa0e [FEAT] price"));
  assert.strictEqual(L.keepLabel({ name: "a".repeat(80) }).length, 5 + 32);
  const sides = { ours: { name: "b".repeat(60), role: "" }, theirs: { name: "t", role: "" } };
  assert.ok(L.hunkChoices(sides, false).every(c => c.label.length <= 40), "no label is longer than a button can hold");
  assert.ok(L.hunkChoices(sides, false)[0].title.includes("b".repeat(60)), "the whole name is in the tooltip");
});
t("conflictKindNote: a file with no places says why, in the words of the sides", () => {
  const sides = { ours: { name: "19.0-release/x", role: "" }, theirs: { name: "174697a [FEAT] cogilog", role: "" } };
  assert.match(L.conflictKindNote("DU", sides), /19\.0-release\/x does not have this file; 174697a \[FEAT\] cogilog changes it/);
  assert.match(L.conflictKindNote("DU", sides), /Keeping 174697a \[FEAT\] cogilog brings the file in/);
  assert.match(L.conflictKindNote("UD", sides), /deletes this file/);
  assert.match(L.conflictKindNote("UA", sides), /adds this file/);
  assert.match(L.conflictKindNote("AU", sides), /has this file/);
  assert.match(L.conflictKindNote("DD", sides), /Both sides deleted/);
  for (const code of ["UU", "AA", "", "XX"]) assert.strictEqual(L.conflictKindNote(code, sides), "", code);
  assert.strictEqual(L.conflictKindNote("DU", null), "", "without the names of the sides there is nothing to say");
});
t("line by line: lines are kept or left out, a side or both is one click, what is written is shown", () => {
  const h = { n: 1, ours: "o-a\no-b\no-c", n_ours: 3, theirs: "t-a\nt-b", n_theirs: 2, base: "b-a", n_base: 1 };
  const lines = L.hunkLines(h);
  assert.deepStrictEqual([lines.o.length, lines.t.length, lines.b.length], [3, 2, 1]);
  assert.deepStrictEqual(L.hunkLines({ ours: "", n_ours: 0, theirs: "x", n_theirs: 1, base: null }).o, [], "no line is not one empty line");
  assert.deepStrictEqual(L.hunkLines({ ours: "", n_ours: 1, theirs: "", n_theirs: 0, base: null }).o, [""], "one empty line is not no line");
  assert.strictEqual(L.hunkLines({ ours: "a", n_ours: 1, theirs: "b", n_theirs: 1, base: null }).b, null);
  // presets
  assert.deepStrictEqual(L.pickResult(h, L.presetPick(h, "ours")).map(l => l.text), ["o-a", "o-b", "o-c"]);
  assert.deepStrictEqual(L.pickResult(h, L.presetPick(h, "theirs")).map(l => l.text), ["t-a", "t-b"]);
  assert.deepStrictEqual(L.pickResult(h, L.presetPick(h, "both")).map(l => l.text), ["o-a", "o-b", "o-c", "t-a", "t-b"]);
  assert.deepStrictEqual(L.pickResult(h, L.presetPick(h, "both-reverse")).map(l => l.text), ["t-a", "t-b", "o-a", "o-b", "o-c"]);
  assert.deepStrictEqual(L.pickResult(h, L.presetPick(h, "base")).map(l => l.text), ["b-a"]);
  for (const id of ["ours", "theirs", "both", "both-reverse", "base"]) assert.strictEqual(L.pickChoice(h, L.presetPick(h, id)), id, id);
  // a click on a line: from nothing; again to leave it out; a click after a preset changes that preset
  let pick = L.togglePick(h, null, "o", 0);
  assert.deepStrictEqual(L.pickResult(h, pick).map(l => l.text), ["o-a"]);
  pick = L.togglePick(h, pick, "t", 1);
  assert.strictEqual(L.pickChoice(h, pick), "pick:o1+t2", "lines one by one, left first");
  pick = L.setOrder(pick, "theirs");
  assert.strictEqual(L.pickChoice(h, pick), "pick:t2+o1", "...or right first");
  pick = L.togglePick(h, pick, "o", 0);
  assert.strictEqual(L.pickChoice(h, pick), "pick:t2");
  pick = L.togglePick(h, pick, "t", 1);
  assert.strictEqual(L.pickChoice(h, pick), "pick:", "nothing kept takes the place out of the file");
  assert.deepStrictEqual(L.pickResult(h, pick), []);
  const afterBoth = L.togglePick(h, L.presetPick(h, "both"), "o", 1);
  assert.strictEqual(L.pickChoice(h, afterBoth), "pick:o1+o3+t1+t2", "a line left out of 'both'");
  assert.strictEqual(L.pickChoice(h, L.togglePick(h, L.presetPick(h, "base"), "t", 0)), "pick:t1", "a click after 'what it was before' starts from nothing");
  // the same text never changes the original pick
  const keep = L.presetPick(h, "both"); L.togglePick(h, keep, "o", 0);
  assert.strictEqual(L.pickChoice(h, keep), "both", "a click makes a new pick");
  // a side with no line, taken whole
  const lonely = { n: 2, ours: "", n_ours: 0, theirs: "x", n_theirs: 1, base: null };
  assert.strictEqual(L.pickChoice(lonely, L.presetPick(lonely, "theirs")), "theirs");
  assert.strictEqual(L.pickChoice(lonely, L.presetPick(lonely, "both")), "theirs", "both of nothing and one line is the one line: the first name that fits");
});
t("stageTone: what the stage says gives its colour, an unknown stage stays neutral", () => {
  for (const [stage, tone] of [["Approved", "neutral"], ["Done", "neutral"], ["To Validate", "warn"], ["Waiting for the client", "warn"], ["Running", "info"], ["Assigned", "info"], ["Meetings", "neutral"], ["", "neutral"], [undefined, "neutral"]]) {
    assert.strictEqual(L.stageTone(stage), tone, String(stage));
  }
});
console.log("  " + n + " passed, 0 failed");
