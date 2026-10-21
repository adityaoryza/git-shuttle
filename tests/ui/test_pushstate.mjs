import assert from "node:assert";
import { pushState, pushTitle, upstreamMarker } from "../../ui/shuttle_ui/static/js/pushstate.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const status = (extra = {}) => ({ branch: "feature/x", protected: "0", upstream: "origin/feature/x", "upstream.ahead": "0", "upstream.behind": "0", operation: "", ...extra });

t("in sync, or behind only: nothing to push", () => {
  assert.strictEqual(pushState(status()).kind, "none");
  assert.strictEqual(pushState(status({ "upstream.behind": "3" })).kind, "none");
  assert.strictEqual(pushState(null).kind, "none");
  assert.strictEqual(pushState(status({ branch: "" })).kind, "none", "a detached HEAD has nothing to publish");
});
t("no upstream: Publish", () => {
  const s = pushState(status({ upstream: "" }));
  assert.deepStrictEqual([s.kind, s.label, s.disabled], ["publish", "Publish", false]);
  assert.match(pushTitle(s), /Publish feature\/x to the remote and set its upstream/);
});
t("commits ahead: Push ↑N", () => {
  const s = pushState(status({ "upstream.ahead": "2" }));
  assert.deepStrictEqual([s.kind, s.label, s.disabled, s.ahead], ["push", "Push ↑2", false, 2]);
  assert.strictEqual(pushTitle(s), "Push 2 commits to origin/feature/x");
  assert.strictEqual(pushTitle(pushState(status({ "upstream.ahead": "1" }))), "Push 1 commit to origin/feature/x");
});
t("ahead and behind: diverged, which needs an explicit force", () => {
  const s = pushState(status({ "upstream.ahead": "2", "upstream.behind": "1" }));
  assert.deepStrictEqual([s.kind, s.label], ["diverged", "Push ↑2 ↓1"]);
  assert.match(pushTitle(s), /diverged/);
});
t("protected branches and a waiting operation disable it, with the reason", () => {
  const p = pushState(status({ protected: "1", "upstream.ahead": "1" }));
  assert.deepStrictEqual([p.kind, p.disabled], ["push", true]);
  assert.match(p.reason, /protected/); assert.strictEqual(pushTitle(p), p.reason);
  const o = pushState(status({ upstream: "", operation: "rebase" }));
  assert.deepStrictEqual([o.kind, o.disabled, o.reason], ["publish", true, "Finish the rebase first."]);
  assert.strictEqual(pushState(status({ protected: "1" })).disabled, false, "nothing to push: nothing to disable");
});
t("upstreamMarker for the picker", () => {
  const local = extra => ({ ref: "refs/heads/a", upstream: "origin/a", ahead: 0, behind: 0, gone: false, ...extra });
  assert.strictEqual(upstreamMarker(local({ upstream: "" })), "not pushed");
  assert.strictEqual(upstreamMarker(local({ gone: true })), "upstream gone");
  assert.strictEqual(upstreamMarker(local({ ahead: 2, behind: 1 })), "↑2 ↓1");
  assert.strictEqual(upstreamMarker(local({ ahead: 3 })), "↑3");
  assert.strictEqual(upstreamMarker(local()), "");
  assert.strictEqual(upstreamMarker({ ref: "refs/remotes/origin/a", name: "origin/a" }), "", "remote branches have no upstream");
});
console.log("  " + n + " passed, 0 failed");
