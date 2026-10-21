import assert from "node:assert";
import { bounds, clampSize, clearSize, dragSize, fitSize, keySize, loadSize, saveSize } from "../../ui/shuttle_ui/static/js/splitter.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const store = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; }, m }; };

t("bounds: the other pane keeps its minimum, and the limits never cross", () => {
  assert.deepStrictEqual(bounds(1000, 200, 300), { min: 200, max: 700 });
  assert.deepStrictEqual(bounds(400, 200, 300), { min: 200, max: 200 }, "a window too small for both: the minimum wins");
});
t("clampSize and fitSize (the window got smaller or bigger)", () => {
  assert.strictEqual(clampSize(50, 100, 500), 100);
  assert.strictEqual(clampSize(900, 100, 500), 500);
  assert.strictEqual(clampSize(250.6, 100, 500), 251);
  assert.strictEqual(fitSize(700, 1000, 200, 300), 700);
  assert.strictEqual(fitSize(700, 800, 200, 300), 500, "shrinks with the window");
  assert.strictEqual(fitSize(250, 3000, 200, 300), 250, "does not grow by itself");
});
t("dragSize moves with the pointer, in the direction the pane grows", () => {
  assert.strictEqual(dragSize(300, 40, 1, 100, 600), 340, "the pane before the handle: right/down grows it");
  assert.strictEqual(dragSize(300, 40, -1, 100, 600), 260, "the pane after the handle: right/down shrinks it");
  assert.strictEqual(dragSize(300, -500, 1, 100, 600), 100);
  assert.strictEqual(dragSize(300, 5000, 1, 100, 600), 600);
});
t("keySize: arrows, Shift for a bigger step, Home and End", () => {
  assert.deepStrictEqual(["ArrowRight", "ArrowLeft"].map(k => keySize(k, false, 300, 100, 600, "x", 1)), [320, 280]);
  assert.deepStrictEqual(["ArrowDown", "ArrowUp"].map(k => keySize(k, true, 300, 100, 600, "y", 1)), [380, 220]);
  assert.deepStrictEqual(["ArrowRight", "ArrowLeft"].map(k => keySize(k, false, 300, 100, 600, "x", -1)), [280, 320], "the sign follows the pane");
  assert.deepStrictEqual([keySize("Home", false, 300, 100, 600, "x", 1), keySize("End", false, 300, 100, 600, "x", 1)], [100, 600]);
  assert.deepStrictEqual([keySize("Home", false, 300, 100, 600, "x", -1), keySize("End", false, 300, 100, 600, "x", -1)], [100, 600], "Home and End are about the pane the handle controls, whichever side it is on");
  assert.strictEqual(keySize("ArrowUp", false, 300, 100, 600, "x", 1), null, "an arrow of the other axis means nothing");
  assert.strictEqual(keySize("a", false, 300, 100, 600, "x", 1), null);
  assert.strictEqual(keySize("ArrowRight", false, 590, 100, 600, "x", 1), 600, "never past the limit");
});
t("the size is remembered, versioned, and a bad value gives the default", () => {
  const s = store();
  assert.strictEqual(loadSize(s, "graph", 360), 360);
  saveSize(s, "graph", 420);
  assert.strictEqual(loadSize(s, "graph", 360), 420);
  assert.strictEqual(loadSize(s, "other", 99), 99);
  for (const bad of ["x", "null", '{"v":2,"size":400}', '{"v":1,"size":"big"}', '{"v":1,"size":-5}', '{"v":1}']) assert.strictEqual(loadSize(store({ "shuttle.split.1.graph": bad }), "graph", 360), 360, bad);
  assert.strictEqual(loadSize({ getItem() { throw new Error("denied"); } }, "graph", 7), 7);
  assert.doesNotThrow(() => saveSize({ setItem() { throw new Error("full"); } }, "graph", 1));
  clearSize(s, "graph"); assert.strictEqual(loadSize(s, "graph", 360), 360);
});
console.log("  " + n + " passed, 0 failed");
