import assert from "node:assert";
import { canSkipPreview, isPreviewSkipped, resetSkippedPreviews, skipPreview, skippedPreviews } from "../../ui/shuttle_ui/static/js/skip-preview.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };

// a browser's localStorage, in memory (node has none)
const store = new Map();
const useStorage = value => Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
useStorage({ getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) });

t("easy-to-undo actions may skip the preview", () => {
  for (const a of ["pull", "switch", "branch", "tag", "cherry-pick", "stash", "sync", "push"]) assert.strictEqual(canSkipPreview(a, {}), true, a);
});
t("risky actions always show it", () => {
  for (const a of ["reset", "discard", "drop", "rewrite", "delete", "delete-remote", "untag", "amend", "worktree-remove", "patch-apply", "move", "revert", "unknown"]) {
    assert.strictEqual(canSkipPreview(a, {}), false, a);
  }
});
t("a safe action asked with care still shows it: a force push, dropping a stash, a destructive tone", () => {
  assert.strictEqual(canSkipPreview("push", { force: true }), false);
  assert.strictEqual(canSkipPreview("stash", { sub: "drop" }), false);
  assert.strictEqual(canSkipPreview("stash", { sub: "pop" }), true);
  assert.strictEqual(canSkipPreview("pull", {}, "destructive"), false);
});
t("the choice is remembered per action, and can be reset", () => {
  assert.deepStrictEqual(skippedPreviews(), []);
  skipPreview("pull"); skipPreview("pull"); skipPreview("switch");
  assert.deepStrictEqual(skippedPreviews().sort(), ["pull", "switch"]);
  assert.strictEqual(isPreviewSkipped("pull", {}), true);
  assert.strictEqual(isPreviewSkipped("branch", {}), false);
  assert.strictEqual(isPreviewSkipped("push", { force: true }), false, "never for a force push, even if push was turned off");
  skipPreview("push");
  assert.strictEqual(isPreviewSkipped("push", { force: true }), false);
  resetSkippedPreviews();
  assert.deepStrictEqual(skippedPreviews(), []);
});
t("a risky action cannot be stored, and damaged storage is ignored", () => {
  skipPreview("reset");
  assert.deepStrictEqual(skippedPreviews(), []);
  for (const bad of ["not json", "{}", "[1,2]", '["reset","pull"]']) {
    store.set("shuttle.skipPreview", bad);
    assert.ok(Array.isArray(skippedPreviews()), bad);
  }
  assert.deepStrictEqual(skippedPreviews(), ["pull"], "only the known safe ones survive");
  const working = globalThis.localStorage;
  useStorage({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
  assert.deepStrictEqual(skippedPreviews(), []);
  assert.doesNotThrow(() => { skipPreview("pull"); resetSkippedPreviews(); });
  useStorage(working);
});
console.log("  " + n + " passed, 0 failed");
