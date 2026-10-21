import assert from "node:assert";
import { OLD_SERVER, REQUIRED_API, checkVersion, isMissingRoute } from "../../ui/shuttle_ui/static/js/version.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };

t("the message tells what to do", () => {
  assert.match(OLD_SERVER, /older than this page/);
  assert.match(OLD_SERVER, /Ctrl-C/);
  assert.match(OLD_SERVER, /git shuttle ui again/);
});
t("a route the server lacks (404 'not found', or no JSON) is an old server", () => {
  assert.ok(isMissingRoute(404, { error: "not found" }));
  assert.ok(isMissingRoute(404, null));
  assert.ok(!isMissingRoute(404, { error: "unknown repository" }), "a real 404 keeps its own message");
  assert.ok(!isMissingRoute(404, { error: "no such commit" }));
  assert.ok(!isMissingRoute(500, { error: "not found" }));
  assert.ok(!isMissingRoute(200, null));
});
t("checkVersion: current, newer, older, missing, malformed", () => {
  assert.deepStrictEqual(checkVersion({ version: "0.1.0", api: REQUIRED_API }), { ok: true });
  assert.deepStrictEqual(checkVersion({ api: REQUIRED_API + 5 }), { ok: true });
  for (const bad of [{ api: REQUIRED_API - 1 }, { api: 0 }, {}, null, undefined, { api: "2" }, { api: null }]) {
    assert.deepStrictEqual(checkVersion(bad), { ok: false, message: OLD_SERVER }, JSON.stringify(bad));
  }
});
t("the page needs at least the level that has the commit routes", () => {
  assert.ok(REQUIRED_API >= 2);
});
console.log("  " + n + " passed, 0 failed");
