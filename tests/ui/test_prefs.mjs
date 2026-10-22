import assert from "node:assert";
import { hiddenFor, isMirrored, mergeStored, pickerFrom, pickerToPref } from "../../ui/shuttle_ui/static/js/prefs.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const storage = values => ({ getItem: key => (key in values ? values[key] : null) });

t("the hidden branches come from the server", () => {
  const r = hiddenFor({ "hidden:a1": ["refs/heads/x", "refs/heads/y"] }, "a1", storage({}));
  assert.deepStrictEqual([[...r.hidden].sort(), r.migrate], [["refs/heads/x", "refs/heads/y"], false]);
});
t("an empty list on the server is an answer: nothing is hidden, and the old storage of the browser is not used again", () => {
  const r = hiddenFor({ "hidden:a1": [] }, "a1", storage({ "shuttle.hidden.a1": '["refs/heads/old"]' }));
  assert.deepStrictEqual([r.hidden.size, r.migrate], [0, false]);
});
t("what the browser kept before is used once, and is to be sent to the server", () => {
  const r = hiddenFor({}, "a1", storage({ "shuttle.hidden.a1": '["refs/heads/old"]' }));
  assert.deepStrictEqual([[...r.hidden], r.migrate], [["refs/heads/old"], true]);
});
t("nothing known: nothing hidden, nothing to send", () => {
  for (const prefs of [{}, null, undefined]) { const r = hiddenFor(prefs, "a1", storage({})); assert.deepStrictEqual([r.hidden.size, r.migrate], [0, false]); }
  assert.strictEqual(hiddenFor({}, "a1", null).hidden.size, 0);
});
t("damaged storage is ignored", () => {
  for (const bad of ["not json", '{"a":1}', "[1,2]", '"x"']) assert.strictEqual(hiddenFor({}, "a1", storage({ "shuttle.hidden.a1": bad })).hidden.size, 0, bad);
  assert.strictEqual(hiddenFor({}, "a1", { getItem() { throw new Error("blocked"); } }).hidden.size, 0);
});
t("another repository has its own", () => {
  const prefs = { "hidden:a1": ["refs/heads/x"] };
  assert.strictEqual(hiddenFor(prefs, "b2", storage({})).hidden.size, 0);
});
t("the branch list is left as it was, with defaults for what was never saved", () => {
  assert.deepStrictEqual([pickerFrom({}).sections, pickerFrom({}).closed.size], [{ Local: true, Remote: false }, 0]);
  const p = pickerFrom({ picker: { sections: { Local: false, Remote: true }, closed: ["Local:19.0-feature", "Remote:x"] } });
  assert.deepStrictEqual([p.sections, [...p.closed]], [{ Local: false, Remote: true }, ["Local:19.0-feature", "Remote:x"]]);
});
t("a damaged state of the branch list falls back to the defaults", () => {
  for (const picker of [null, 5, "x", { sections: "x", closed: "y" }, { sections: { Local: "no" }, closed: [1, 2] }]) {
    const p = pickerFrom({ picker });
    assert.deepStrictEqual([p.sections.Remote, p.closed.size], [false, 0], JSON.stringify(picker));
  }
});
t("what is saved is the same shape, sorted", () => {
  assert.deepStrictEqual(pickerToPref({ Local: true, Remote: false }, new Set(["b", "a"])), { sections: { Local: true, Remote: false }, closed: ["a", "b"] });
  const again = pickerFrom({ picker: pickerToPref({ Local: false, Remote: true }, new Set(["x"])) });
  assert.deepStrictEqual([again.sections, [...again.closed]], [{ Local: false, Remote: true }, ["x"]]);
});
const store = values => { const m = new Map(Object.entries(values)); return { map: m, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
t("the settings of the page that are copied to the server: shuttle.* only, and not the hidden branches (they have their own place)", () => {
  for (const key of ["shuttle.theme", "shuttle.table.worktree", "shuttle.panel:w", "shuttle.pushNewBranch"]) assert.ok(isMirrored(key), key);
  for (const key of ["theme", "shuttle", "shuttle.", "shuttle.hidden.a1", "other.shuttle.x", "shuttle.a b", "shuttle.a/b", "", null, 5]) assert.ok(!isMirrored(key), String(key));
});
t("what the server kept comes back into an empty storage (another port)", () => {
  const s = store({});
  const upload = mergeStored({ "ls:shuttle.theme": "light", "ls:shuttle.panelSize": "420", "hidden:a1": ["x"], repo: "abc" }, s);
  assert.deepStrictEqual([...s.map.entries()], [["shuttle.theme", "light"], ["shuttle.panelSize", "420"]]);
  assert.deepStrictEqual(upload, {});
});
t("the server wins when both have a setting, and what only the storage has is sent to the server", () => {
  const s = store({ "shuttle.theme": "dark", "shuttle.columns": "[1]", "unrelated": "x", "shuttle.hidden.a1": "[]" });
  const upload = mergeStored({ "ls:shuttle.theme": "light" }, s);
  assert.strictEqual(s.getItem("shuttle.theme"), "light");
  assert.deepStrictEqual(upload, { "shuttle.columns": "[1]" });
});
t("damaged answers are ignored, and a storage that refuses does not stop the page", () => {
  const s = store({});
  assert.deepStrictEqual(mergeStored({ "ls:shuttle.a": 5, "ls:shuttle.b": null, "ls:bad key": "x", "ls:other": "x", "ls:shuttle.ok": "1" }, s), {});
  assert.deepStrictEqual([...s.map.entries()], [["shuttle.ok", "1"]]);
  assert.deepStrictEqual(mergeStored(null, store({})), {});
  assert.deepStrictEqual(mergeStored(null, s), { "shuttle.ok": "1" }, "with nothing from the server, what the storage has is sent");
  assert.doesNotThrow(() => mergeStored({ "ls:shuttle.x": "1" }, s, () => { throw new Error("full"); }));
});
console.log("  " + n + " passed, 0 failed");
