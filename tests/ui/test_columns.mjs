import assert from "node:assert";
import { clamp, clearPrefs, dropIndex, fitWidth, keyResize, layoutWidths, loadPrefs, middleEllipsis, moveColumn, nextSort, orderedColumns, resizeBy, savePrefs, shiftColumn, sortRows, startWidths, statusRank, visibleColumns } from "../../ui/shuttle_ui/static/js/columns.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const cols = [
  { key: "name", label: "Name", min: 120, width: 220, priority: 9 },
  { key: "path", label: "Path", min: 80, width: 200, priority: 3 },
  { key: "changes", label: "Changes", min: 70, width: 100, priority: 4 },
  { key: "size", label: "Size", min: 50, width: 70, priority: 1 },
];
const store = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; }, m }; };

t("clamp keeps a width between min and max", () => {
  assert.strictEqual(clamp({ min: 50, max: 300 }, 10), 50);
  assert.strictEqual(clamp({ min: 50, max: 300 }, 999), 300);
  assert.strictEqual(clamp({ min: 50, max: 300 }, 120.4), 120);
  assert.strictEqual(clamp({}, 5), 40, "a column without limits is never narrower than 40");
});
t("preferences: saved per table, versioned, and safe on garbage", () => {
  const s = store();
  assert.deepStrictEqual(loadPrefs(s, "files"), { widths: {}, hidden: [], sort: null, order: [], opts: {} });
  savePrefs(s, "files", { widths: { name: 300 }, hidden: ["size"], sort: { key: "name", dir: "desc" }, order: ["size", "name"], opts: { dates: "absolute" } });
  assert.deepStrictEqual(loadPrefs(s, "files"), { widths: { name: 300 }, hidden: ["size"], sort: { key: "name", dir: "desc" }, order: ["size", "name"], opts: { dates: "absolute" } });
  assert.deepStrictEqual(loadPrefs(s, "other").widths, {}, "another table has its own");
  for (const bad of ["not json", "null", "[]", '{"v":99,"widths":{"a":1}}', '{"v":1,"widths":"x","hidden":5,"sort":{"key":3}}', '{"v":1,"widths":{"a":-4,"b":"x","c":120}}']) {
    const p = loadPrefs(store({ "shuttle.table.1.files": bad }), "files");
    assert.ok(typeof p.widths === "object" && Array.isArray(p.hidden), bad);
  }
  assert.deepStrictEqual(loadPrefs(store({ "shuttle.table.1.files": '{"v":1,"widths":{"a":-4,"b":"x","c":120}}' }), "files").widths, { c: 120 });
  assert.doesNotThrow(() => savePrefs({ setItem() { throw new Error("full"); } }, "x", { widths: {}, hidden: [], sort: null }));
  assert.deepStrictEqual(loadPrefs({ getItem() { throw new Error("denied"); } }, "x").sort, null);
  clearPrefs(s, "files"); assert.deepStrictEqual(loadPrefs(s, "files").widths, {});
});
t("startWidths: saved first, then the default, always inside the limits", () => {
  assert.deepStrictEqual(startWidths(cols, { name: 10, path: 150 }), { name: 120, path: 150, changes: 100, size: 70 });
});
t("visibleColumns: the least important go first, the name stays", () => {
  const keys = room => visibleColumns(cols, [], room).map(c => c.key);
  assert.deepStrictEqual(keys(1000), ["name", "path", "changes", "size"]);
  assert.deepStrictEqual(keys(320), ["name", "path", "changes", "size"], "all of them just fit");
  assert.deepStrictEqual(keys(300), ["name", "path", "changes"], "Size is the first to go");
  assert.deepStrictEqual(keys(250), ["name", "changes"], "then Path");
  assert.deepStrictEqual(keys(150), ["name"], "then Changes");
  assert.deepStrictEqual(keys(50), ["name"], "never fewer than the name");
  assert.deepStrictEqual(visibleColumns(cols, ["path", "name"], 1000).map(c => c.key), ["name", "changes", "size"], "the user's choice; but not the name");
});
t("layoutWidths: the last column takes the rest and nothing overflows", () => {
  const shown = cols.slice(0, 3);
  const w = layoutWidths(shown, { name: 220, path: 200, changes: 100 }, 800);
  assert.deepStrictEqual(w, { name: 220, path: 200, changes: 380 });
  assert.strictEqual(Object.values(w).reduce((a, b) => a + b, 0), 800);
  const tight = layoutWidths(shown, { name: 220, path: 200, changes: 100 }, 400);
  assert.strictEqual(Object.values(tight).reduce((a, b) => a + b, 0), 400, "the sum is the room");
  assert.ok(tight.changes >= 70 && tight.name >= 120 && tight.path >= 80, JSON.stringify(tight));
  assert.deepStrictEqual(layoutWidths([cols[0]], { name: 220 }, 500), { name: 500 }, "one column fills the table");
});
t("resizeBy and keyResize", () => {
  assert.deepStrictEqual(resizeBy(cols, { name: 220 }, "name", 30), { name: 250 });
  assert.deepStrictEqual(resizeBy(cols, { name: 220 }, "name", -500), { name: 120 }, "not below the minimum");
  assert.deepStrictEqual(resizeBy(cols, { name: 220 }, "nothing", 5), { name: 220 });
  const col = { min: 60, max: 400 };
  assert.deepStrictEqual(["ArrowLeft", "ArrowRight", "Home", "End", "x"].map(k => keyResize(col, 200, k, false)), [190, 210, 60, 400, null]);
  assert.deepStrictEqual([keyResize(col, 200, "ArrowLeft", true), keyResize(col, 200, "ArrowRight", true)], [160, 240], "Shift: a bigger step");
});
t("fitWidth: the widest content wins, within the limits", () => {
  const measure = text => text.length * 7;
  assert.strictEqual(fitWidth({ key: "p", label: "Path", min: 50, max: 900 }, ["a.py", "billing/invoice.py"], measure), 18 * 7 + 24);
  assert.strictEqual(fitWidth({ key: "p", label: "Path", min: 50, max: 150 }, ["x".repeat(100)], measure), 150, "the maximum");
  assert.strictEqual(fitWidth({ key: "p", label: "A rather long header", min: 50, max: 900 }, [], measure), 20 * 7 + 20 + 24, "the header counts");
  assert.strictEqual(fitWidth({ key: "p", label: "x", min: 50, max: 900 }, [null, undefined, 5], measure), 51, "empty and numeric cells are fine");
});
t("nextSort cycles ascending, descending, none; a new column starts ascending", () => {
  let s = nextSort(null, "name"); assert.deepStrictEqual(s, { key: "name", dir: "asc" });
  s = nextSort(s, "name"); assert.deepStrictEqual(s, { key: "name", dir: "desc" });
  assert.strictEqual(nextSort(s, "name"), null);
  assert.deepStrictEqual(nextSort({ key: "name", dir: "desc" }, "size"), { key: "size", dir: "asc" });
});
t("sortRows is stable, numeric where it should be, and does nothing without a sort", () => {
  const rows = [{ n: "b10", s: "A" }, { n: "b2", s: "M" }, { n: "a", s: "M" }, { n: "c", s: "?" }];
  const acc = { n: r => r.n, s: r => statusRank(r.s) };
  assert.deepStrictEqual(sortRows(rows, { key: "n", dir: "asc" }, acc).map(r => r.n), ["a", "b2", "b10", "c"], "natural order: b2 before b10");
  assert.deepStrictEqual(sortRows(rows, { key: "n", dir: "desc" }, acc).map(r => r.n), ["c", "b10", "b2", "a"]);
  assert.deepStrictEqual(sortRows(rows, { key: "s", dir: "asc" }, acc).map(r => r.n), ["b2", "a", "b10", "c"], "M, M (in the original order), A, ?");
  assert.strictEqual(sortRows(rows, null, acc), rows);
  assert.strictEqual(sortRows(rows, { key: "zzz", dir: "asc" }, acc), rows);
  assert.deepStrictEqual(sortRows([{ v: 3 }, { v: 12 }, { v: 2 }], { key: "v", dir: "asc" }, { v: r => r.v }).map(r => r.v), [2, 3, 12], "numbers compare as numbers");
});
t("statusRank: modified, added, deleted, renamed ... untracked last", () => {
  assert.deepStrictEqual(["?", "D", "A", "M", "R", "U", "X"].sort((a, b) => statusRank(a) - statusRank(b)), ["M", "A", "R", "D", "U", "?", "X"]);
  assert.ok(statusRank("M") < statusRank("A") && statusRank("A") < statusRank("D") && statusRank("D") < statusRank("?"));
});
t("middleEllipsis keeps the file name and fits", () => {
  const fits = max => text => text.length <= max;
  assert.strictEqual(middleEllipsis("billing/invoice.py", fits(40)), "billing/invoice.py", "short enough: untouched");
  const cut = middleEllipsis("modules/very/deep/folder/structure/here/invoice_total.py", fits(30));
  assert.ok(cut.endsWith("invoice_total.py") && cut.includes("…") && cut.length <= 30, cut);
  assert.strictEqual(middleEllipsis("a/b/c/long_file_name_that_does_not_fit.py", fits(12)).includes("long_file"), true, "the name is kept as long as it can be");
  assert.ok(middleEllipsis("x".repeat(60) + ".py", fits(20)).length <= 20, "a long name without folders shortens in the middle");
  assert.ok(middleEllipsis("a.py", fits(2)).length <= 4);
});

const graphCols = [
  { key: "refs", label: "Branch / Tag", min: 80, width: 170, priority: 7 },
  { key: "graph", label: "Graph", min: 56, width: 120, priority: 8, required: true },
  { key: "message", label: "Message", min: 140, width: 300, priority: 9, required: true, flex: true },
  { key: "author", label: "Author", min: 80, width: 140, priority: 3 },
  { key: "date", label: "Date", min: 70, width: 100, priority: 5 },
  { key: "sha", label: "SHA", min: 64, width: 80, priority: 4 },
];
t("orderedColumns: the arranged keys first, new columns after, unknown and repeated keys ignored", () => {
  assert.deepStrictEqual(orderedColumns(graphCols, []).map(c => c.key), ["refs", "graph", "message", "author", "date", "sha"]);
  assert.deepStrictEqual(orderedColumns(graphCols, ["date", "refs"]).map(c => c.key), ["date", "refs", "graph", "message", "author", "sha"]);
  assert.deepStrictEqual(orderedColumns(graphCols, ["gone", "date", "date", "message"]).map(c => c.key), ["date", "message", "refs", "graph", "author", "sha"]);
});
t("moveColumn puts a column at a position and never loses one", () => {
  assert.deepStrictEqual(moveColumn(graphCols, [], "sha", 0), ["sha", "refs", "graph", "message", "author", "date"]);
  assert.deepStrictEqual(moveColumn(graphCols, [], "refs", 99), ["graph", "message", "author", "date", "sha", "refs"]);
  assert.deepStrictEqual(moveColumn(graphCols, [], "refs", -5)[0], "refs");
  assert.deepStrictEqual(moveColumn(graphCols, [], "nothing", 1), ["refs", "graph", "message", "author", "date", "sha"]);
  assert.strictEqual(moveColumn(graphCols, ["date"], "author", 0).length, graphCols.length);
});
t("shiftColumn: Alt+Arrow moves one step among the shown columns", () => {
  const shown = ["refs", "message", "date"];                                   // graph, author and sha are hidden
  assert.deepStrictEqual(shiftColumn(graphCols, [], shown, "date", -1).slice(0, 4), ["refs", "graph", "date", "message"]);
  assert.deepStrictEqual(shiftColumn(graphCols, [], shown, "refs", -1), orderedColumns(graphCols, []).map(c => c.key), "at the edge nothing moves");
  assert.deepStrictEqual(shiftColumn(graphCols, [], shown, "date", 1), orderedColumns(graphCols, []).map(c => c.key));
  assert.deepStrictEqual(shiftColumn(graphCols, [], shown, "nothing", 1), orderedColumns(graphCols, []).map(c => c.key));
});
t("dropIndex: a dragged header lands before the column whose middle it passed", () => {
  assert.strictEqual(dropIndex([100, 100, 100], 10), 0);
  assert.strictEqual(dropIndex([100, 100, 100], 60), 1);
  assert.strictEqual(dropIndex([100, 100, 100], 149), 1);
  assert.strictEqual(dropIndex([100, 100, 100], 151), 2);
  assert.strictEqual(dropIndex([100, 100, 100], 900), 2);
  assert.strictEqual(dropIndex([100, 100, 100], -20), 0);
});
t("required columns are never hidden or dropped; a narrow table drops author, then sha, then date before the message", () => {
  const keys = list => list.map(c => c.key);
  assert.deepStrictEqual(keys(visibleColumns(graphCols, ["graph", "message", "author"], 2000)), ["refs", "graph", "message", "date", "sha"], "required columns ignore the hide list");
  assert.deepStrictEqual(keys(visibleColumns(graphCols, [], 2000)), keys(graphCols));
  assert.deepStrictEqual(keys(visibleColumns(graphCols, [], 450)), ["refs", "graph", "message", "date", "sha"], "the author goes first");
  assert.deepStrictEqual(keys(visibleColumns(graphCols, [], 400)), ["refs", "graph", "message", "date"], "then the sha");
  assert.deepStrictEqual(keys(visibleColumns(graphCols, [], 340)), ["refs", "graph", "message"], "then the date");
  assert.deepStrictEqual(keys(visibleColumns(graphCols, [], 100)), ["graph", "message"], "and in the end only what is required");
});
t("layoutWidths: the flex column takes the rest wherever it stands, and the others shrink from the end", () => {
  const shown = visibleColumns(graphCols, [], 2000);
  const w = layoutWidths(shown, startWidths(graphCols, {}), 1000);
  assert.strictEqual(Object.values(w).reduce((a, b) => a + b, 0), 1000, "the widths add up to the room");
  assert.strictEqual(w.message, 1000 - 170 - 120 - 140 - 100 - 80, "the message is the flex column");
  const tight = layoutWidths(shown, startWidths(graphCols, {}), 620);
  assert.strictEqual(Object.values(tight).reduce((a, b) => a + b, 0), 620);
  assert.ok(Object.entries(tight).every(([k, v]) => v >= graphCols.find(c => c.key === k).min), "never under a minimum");
  const first = layoutWidths(visibleColumns([{ ...graphCols[2], flex: true }, ...graphCols.filter(c => c.key !== "message")], [], 2000), {}, 700);
  assert.strictEqual(first.message, 140, "a flex column at the start gets at least its minimum, the others give way");
  assert.strictEqual(Object.values(first).reduce((a, b) => a + b, 0), 700);
  const roomy = layoutWidths(visibleColumns([{ ...graphCols[2], flex: true }, ...graphCols.filter(c => c.key !== "message")], [], 2000), {}, 900);
  assert.strictEqual(roomy.message, 900 - 170 - 120 - 140 - 100 - 80, "a flex column at the start takes the rest too");
});
t("preferences keep the order and the options, and ignore damaged ones", () => {
  const s = store();
  savePrefs(s, "graph", { widths: {}, hidden: [], sort: null, order: ["date", "refs"], opts: { dates: "absolute", email: true } });
  assert.deepStrictEqual(loadPrefs(s, "graph").order, ["date", "refs"]);
  assert.deepStrictEqual(loadPrefs(s, "graph").opts, { dates: "absolute", email: true });
  const bad = loadPrefs(store({ "shuttle.table.1.graph": '{"v":1,"order":[1,"a"],"opts":{"x":{"y":1},"ok":"1","n":[1]}}' }), "graph");
  assert.deepStrictEqual(bad.order, ["a"]);
  assert.deepStrictEqual(bad.opts, { ok: "1" });
  assert.deepStrictEqual(loadPrefs(store({ "shuttle.table.1.graph": '{"v":1,"opts":[1,2]}' }), "graph").opts, {});
});
console.log("  " + n + " passed, 0 failed");
