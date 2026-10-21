import assert from "node:assert";
import { parseDiff, splitRows, headerNotes } from "../../ui/shuttle_ui/static/js/diff.js";
import { buildTree, flattenTree, orderedFiles, filterFiles, totals, sameFile } from "../../ui/shuttle_ui/static/js/filetree.js";
import { formatSize, fullDate } from "../../ui/shuttle_ui/static/js/format.js";
import { highlightLine, languageOf } from "../../ui/shuttle_ui/static/js/highlight.js";
import { repoLabels } from "../../ui/shuttle_ui/static/js/repos.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };

const SAMPLE = `diff --git a/a.txt b/a.txt
index 111..222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,5 @@ def main():
 one
-two
+TWO
+two and a half
 three
@@ -10,2 +11,2 @@
 ten
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;

t("parseDiff: header, hunks, numbers on both sides, totals", () => {
  const d = parseDiff(SAMPLE);
  assert.strictEqual(d.header.length, 4);
  assert.strictEqual(d.hunks.length, 2);
  assert.strictEqual(d.hunks[0].section, "def main():");
  assert.deepStrictEqual(d.hunks[0].rows.map(r => [r.type, r.old, r.new]), [["ctx", 1, 1], ["del", 2, null], ["add", null, 2], ["add", null, 3], ["ctx", 3, 4]]);
  assert.deepStrictEqual([d.additions, d.deletions], [3, 2]);
  assert.strictEqual(d.hunks[1].rows[0].old, 10);
  assert.strictEqual(d.hunks[1].rows[0].new, 11);
});
t("parseDiff: 'no newline' notes belong to no line number", () => {
  const rows = parseDiff(SAMPLE).hunks[1].rows;
  assert.deepStrictEqual(rows.filter(r => r.type === "note").map(r => r.text), ["No newline at end of file", "No newline at end of file"]);
  assert.ok(rows.filter(r => r.type === "note").every(r => r.old === null && r.new === null));
});
t("parseDiff: empty input, no hunk, single-line hunk header, lines that look like markers", () => {
  assert.deepStrictEqual(parseDiff(""), { header: [], hunks: [], additions: 0, deletions: 0 });
  assert.strictEqual(parseDiff("diff --git a/x b/x\nsimilarity index 100%\nrename from a\nrename to b\n").hunks.length, 0);
  const d = parseDiff("@@ -3 +3 @@\n-a\n+b\n+++ not a header: it is an added line starting with ++\n--- also a removed line\n");
  assert.deepStrictEqual(d.hunks[0].rows.map(r => r.type), ["del", "add", "add", "del"]);
  assert.strictEqual(parseDiff("@@ -0,0 +1 @@\n+x\n").hunks[0].rows[0].new, 1);
});
t("parseDiff: tabs, unicode and CRLF stay in the text", () => {
  const d = parseDiff("@@ -1 +1 @@\n-\tà\r\n+é\r\n");
  assert.strictEqual(d.hunks[0].rows[0].text, "\tà\r");
});
t("splitRows: removed and added lines meet; context on both sides", () => {
  const rows = parseDiff(SAMPLE).hunks[0].rows;
  const s = splitRows(rows);
  assert.strictEqual(s.length, 4);
  assert.strictEqual(s[1].left.text, "two"); assert.strictEqual(s[1].right.text, "TWO");
  assert.strictEqual(s[2].left, null); assert.strictEqual(s[2].right.text, "two and a half");
  assert.strictEqual(s[0].left, s[0].right);
});
t("headerNotes", () => {
  assert.deepStrictEqual(headerNotes(["diff --git a/x b/y", "similarity index 75%", "rename from x", "rename to y"]), ["75% similar", "renamed from x"]);
  assert.deepStrictEqual(headerNotes(["new file mode 100644"]), ["new file"]);
  assert.deepStrictEqual(headerNotes(["deleted file mode 100644"]), ["deleted file"]);
  assert.deepStrictEqual(headerNotes(undefined), []);
});

const F = (path, extra = {}) => ({ path, status: "M", additions: 1, deletions: 0, ...extra });
t("buildTree: folders first, a folder with one folder is one line, files sorted", () => {
  const root = buildTree([F("b.txt"), F("src/app/main.py"), F("src/app/util.py"), F("src/readme.md"), F("a/b/c/deep.txt"), F("A.txt")]);
  assert.deepStrictEqual(root.children.map(c => c.name), ["a/b/c", "src", "A.txt", "b.txt"]);
  const src = root.children[1];
  assert.deepStrictEqual(src.children.map(c => c.name), ["app", "readme.md"]);
  assert.strictEqual(root.children[0].path, "a/b/c");
});
t("flattenTree: closed folders hide their files; orderedFiles follows the tree", () => {
  const files = [F("z.txt"), F("d/y.txt"), F("d/x.txt")];
  const rows = flattenTree(buildTree(files));
  assert.deepStrictEqual(rows.map(r => r.node.name + ":" + r.depth), ["d:0", "x.txt:1", "y.txt:1", "z.txt:0"]);
  assert.deepStrictEqual(flattenTree(buildTree(files), new Set(["d"])).map(r => r.node.name), ["d", "z.txt"]);
  assert.deepStrictEqual(orderedFiles(files, "tree").map(f => f.path), ["d/x.txt", "d/y.txt", "z.txt"]);
  assert.deepStrictEqual(orderedFiles(files, "list").map(f => f.path), ["z.txt", "d/y.txt", "d/x.txt"]);
});
t("buildTree: names with spaces, quotes and unicode; an empty list", () => {
  const root = buildTree([F('we ird "q"/ünï.txt'), F("x/ünï.txt")]);
  assert.deepStrictEqual(root.children.map(c => c.name), ['we ird "q"', "x"]);
  assert.deepStrictEqual(buildTree([]).children, []);
});
t("filterFiles, totals, sameFile", () => {
  const files = [F("src/a.py", { additions: 3, deletions: 1 }), F("docs/B.md", { additions: null, deletions: null, binary: true }), F("n.py", { old_path: "old/name.py" })];
  assert.deepStrictEqual(filterFiles(files, "PY").map(f => f.path), ["src/a.py", "n.py"]);
  assert.deepStrictEqual(filterFiles(files, "old/name").map(f => f.path), ["n.py"]);
  assert.strictEqual(filterFiles(files, "  ").length, 3);
  assert.deepStrictEqual(totals(files), { files: 3, additions: 4, deletions: 1 });
  assert.ok(sameFile({ path: "a", group: "staged" }, { path: "a", group: "staged" }));
  assert.ok(!sameFile({ path: "a", group: "staged" }, { path: "a", group: "unstaged" }));
  assert.ok(!sameFile(null, { path: "a" }));
});
t("formatSize and fullDate", () => {
  assert.deepStrictEqual([0, 1023, 1024, 1536, 20480, 1048576, 5 * 1048576].map(formatSize), ["0 B", "1023 B", "1.0 KB", "1.5 KB", "20 KB", "1.0 MB", "5.0 MB"]);
  assert.strictEqual(formatSize(null), "");
  assert.strictEqual(fullDate(0), "");
  assert.match(fullDate(1792580000), /^20\d\d-\d\d-\d\d \d\d:\d\d$/);
});
t("highlightLine: pieces put back together are the line", () => {
  const samples = [["py", 'def f(x):  # note "q"'], ["js", "const a = `x${y}` + 'z'; // c"], ["xml", '<field name="a">1</field><!-- c -->'], ["css", "a { color: red; /* c */ }"], ["sh", 'echo "$HOME" # x'], ["json", '{"a": [1, true, null]}'], ["md", "## Title"], ["py", ""], ["", "plain"]];
  for (const [lang, line] of samples) assert.strictEqual(highlightLine(line, lang).map(p => p.text).join(""), line, lang + ": " + line);
});
t("highlightLine: kinds", () => {
  const kinds = (line, lang) => highlightLine(line, lang).filter(p => p.kind).map(p => p.kind + ":" + p.text);
  assert.deepStrictEqual(kinds("return 42  # done", "py"), ["kw:return", "num:42", "com:# done"]);
  assert.deepStrictEqual(kinds('x = "a#b"', "py"), ["str:\"a#b\""]);
  assert.deepStrictEqual(kinds("<div>", "xml"), ["tag:<div"]);
  assert.deepStrictEqual(kinds("# Title", "md"), ["kw:# Title"]);
  assert.deepStrictEqual(kinds("a" + "x".repeat(500), "py"), [], "a very long line is left alone");
  assert.deepStrictEqual(kinds("class", "py"), ["kw:class"]);
  assert.deepStrictEqual(kinds("classy = 1", "py"), ["num:1"]);
});
t("languageOf", () => {
  assert.deepStrictEqual(["a/b.PY", "x.js", "x.mjs", "d.xml", "Makefile", "x.unknown", "dir.d/file"].map(languageOf), ["py", "js", "js", "xml", "", "", ""]);
});
t("repoLabels: only repositories that share a name get a place", () => {
  const repos = [
    { id: "1", name: "shop", path: "/home/a/work/shop" },
    { id: "2", name: "shop", path: "/home/a/play/shop" },
    { id: "3", name: "site", path: "/srv/site" },
  ];
  assert.deepStrictEqual(repoLabels(repos).map(l => l.label), ["shop — work/shop", "shop — play/shop", "site"]);
  assert.deepStrictEqual(repoLabels(repos).map(l => l.title), repos.map(r => r.path));
  assert.deepStrictEqual(repoLabels([]), []);
  assert.strictEqual(repoLabels([{ id: "1", name: "x", path: "/" }, { id: "2", name: "x", path: "/a" }])[0].label, "x — ");
});
console.log("  " + n + " passed, 0 failed");
