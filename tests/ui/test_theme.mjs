import assert from "node:assert";
import { THEMES, applyTheme, currentTheme, otherTheme, savedTheme, systemTheme } from "../../ui/shuttle_ui/static/js/theme.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const fakeStorage = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
const fakeRoot = () => { const a = {}; return { a, setAttribute: (k, v) => { a[k] = v; } }; };
const prefers = dark => query => ({ matches: dark && query.includes("dark") });

t("there are two themes, and the button switches between them", () => {
  assert.deepStrictEqual(THEMES, ["light", "dark"]);
  assert.strictEqual(otherTheme("light"), "dark");
  assert.strictEqual(otherTheme("dark"), "light");
});
t("savedTheme: only a known value counts", () => {
  assert.strictEqual(savedTheme(fakeStorage({ "shuttle.theme": "dark" })), "dark");
  assert.strictEqual(savedTheme(fakeStorage({ "shuttle.theme": "system" })), null, "the old 'system' value is ignored");
  assert.strictEqual(savedTheme(fakeStorage({ "shuttle.theme": "purple" })), null);
  assert.strictEqual(savedTheme(fakeStorage()), null);
  assert.strictEqual(savedTheme({ getItem() { throw new Error("denied"); } }), null);
});
t("systemTheme follows prefers-color-scheme, and defaults to light", () => {
  assert.strictEqual(systemTheme(prefers(true)), "dark");
  assert.strictEqual(systemTheme(prefers(false)), "light");
  assert.strictEqual(systemTheme(undefined), "light");
  assert.strictEqual(systemTheme(() => { throw new Error("no media"); }), "light");
});
t("currentTheme: a saved choice always wins over the system", () => {
  assert.strictEqual(currentTheme(fakeStorage({ "shuttle.theme": "light" }), prefers(true)), "light");
  assert.strictEqual(currentTheme(fakeStorage({ "shuttle.theme": "dark" }), prefers(false)), "dark");
  assert.strictEqual(currentTheme(fakeStorage(), prefers(true)), "dark");
  assert.strictEqual(currentTheme(fakeStorage(), prefers(false)), "light");
});
t("applyTheme: always sets the attribute; saves only when asked", () => {
  const root = fakeRoot(), st = fakeStorage();
  applyTheme("dark", root, st, false);
  assert.deepStrictEqual([root.a["data-theme"], st.m["shuttle.theme"]], ["dark", undefined], "the first visit saves nothing");
  applyTheme("light", root, st, true);
  assert.deepStrictEqual([root.a["data-theme"], st.m["shuttle.theme"]], ["light", "light"], "a click is a choice");
  assert.doesNotThrow(() => applyTheme("dark", root, { setItem() { throw new Error("denied"); } }, true));
});
console.log("  " + n + " passed, 0 failed");
