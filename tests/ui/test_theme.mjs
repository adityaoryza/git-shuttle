import assert from "node:assert";
import { THEMES, applyTheme, nextTheme, readTheme } from "../../ui/shuttle_ui/static/js/theme.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const fakeStorage = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, m }; };
const fakeRoot = () => { const a = {}; return { a, setAttribute: (k, v) => { a[k] = v; }, removeAttribute: k => { delete a[k]; } }; };

t("the cycle: system → light → dark → system", () => {
  assert.deepStrictEqual(THEMES, ["system", "light", "dark"]);
  assert.deepStrictEqual(["system", "light", "dark"].map(nextTheme), ["light", "dark", "system"]);
  assert.strictEqual(nextTheme("nonsense"), "system", "an unknown value starts the cycle again");
});
t("readTheme: only a known value is accepted; no storage means system", () => {
  assert.strictEqual(readTheme(fakeStorage({ "shuttle.theme": "dark" })), "dark");
  assert.strictEqual(readTheme(fakeStorage({ "shuttle.theme": "purple" })), "system");
  assert.strictEqual(readTheme(fakeStorage()), "system");
  assert.strictEqual(readTheme({ getItem() { throw new Error("denied"); } }), "system");
});
t("applyTheme: sets or removes the attribute, and remembers", () => {
  const root = fakeRoot(), st = fakeStorage();
  applyTheme("dark", root, st);
  assert.deepStrictEqual([root.a["data-theme"], st.m["shuttle.theme"]], ["dark", "dark"]);
  applyTheme("light", root, st);
  assert.strictEqual(root.a["data-theme"], "light");
  applyTheme("system", root, st);
  assert.deepStrictEqual([root.a["data-theme"], st.m["shuttle.theme"]], [undefined, undefined], "system leaves it to the browser and forgets the choice");
  assert.doesNotThrow(() => applyTheme("dark", root, { setItem() { throw new Error("denied"); }, removeItem() {} }));
});
console.log("  " + n + " passed, 0 failed");
