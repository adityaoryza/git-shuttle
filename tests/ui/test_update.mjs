import assert from "node:assert";
import { describeApplied, describeCheck, describeFailure } from "../../ui/shuttle_ui/static/js/update.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const info = over => ({ current: "0.1.1", latest: "0.1.2", available: true, can_update: true, kind: "installed", reason: "", notes: "https://example.test/notes", ...over });

t("a newer release that can be installed offers the update", () => {
  const d = describeCheck(info());
  assert.strictEqual(d.title, "0.1.2 is available (you have 0.1.1)");
  assert.deepStrictEqual([d.tone, d.canUpdate, d.notes], ["info", true, "https://example.test/notes"]);
});
t("a newer release for a copy that cannot be updated says why, and offers nothing", () => {
  const d = describeCheck(info({ can_update: false, kind: "checkout", reason: "this copy is a git checkout: update it with git pull" }));
  assert.strictEqual(d.canUpdate, false);
  assert.strictEqual(d.tone, "warn");
  assert.match(d.detail, /git pull/);
});
t("without a reason there is still a sentence", () => {
  assert.ok(describeCheck(info({ can_update: false, reason: "" })).detail.length > 10);
});
t("the latest release says so, and offers nothing", () => {
  const d = describeCheck(info({ available: false, latest: "0.1.1" }));
  assert.strictEqual(d.title, "You have the latest release (0.1.1)");
  assert.deepStrictEqual([d.tone, d.canUpdate], ["ok", false]);
});
t("nothing known yet: nothing to show", () => {
  assert.deepStrictEqual(describeCheck(null), { tone: "neutral", title: "", detail: "", canUpdate: false, notes: "" });
});
t("an installed update says to restart the page's server", () => {
  const d = describeApplied({ version: "0.1.2" });
  assert.strictEqual(d.title, "Updated to 0.1.2");
  assert.match(d.detail, /Ctrl-C/);
  assert.strictEqual(describeApplied({}).title, "Updated");
});
t("a failure is one sentence, with a fallback", () => {
  assert.strictEqual(describeFailure(new Error("cannot reach https://x: are you online?")), "cannot reach https://x: are you online?");
  assert.ok(describeFailure(null).length > 5);
  assert.ok(describeFailure(new Error("")).length > 5);
});
console.log("  " + n + " passed, 0 failed");
