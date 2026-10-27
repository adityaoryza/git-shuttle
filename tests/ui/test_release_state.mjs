import assert from "node:assert";
import { commitStages, stageOfCandidate, stageText, stageTitle } from "../../ui/shuttle_ui/static/js/release-state.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const state = { set: true, release: "r1", prod: ["r1", "r0"], staging: ["s1", "s2"], queued: { q1: "19.0-release/261027-v1.0" }, equivalent: ["e1"] };

t("a commit is in prod when the release branch has it, or the same patch under another hash", () => {
  const stages = commitStages(state);
  assert.strictEqual(stages.get("r0").kind, "prod");
  assert.strictEqual(stages.get("e1").kind, "prod");
});
t("a merged commit that no release has is staging, and one in a release that is not merged says which", () => {
  const stages = commitStages(state);
  assert.strictEqual(stages.get("s1").kind, "staging");
  assert.deepStrictEqual(stages.get("q1"), { kind: "queued", name: "19.0-release/261027-v1.0" });
});
t("any other commit says nothing, and so does a repository without a release branch", () => {
  assert.strictEqual(commitStages(state).get("feature-only"), undefined);
  assert.strictEqual(commitStages({ set: false }).size, 0);
  assert.strictEqual(commitStages(null).size, 0);
});
t("a queued commit wins over the other lists (it is in an open release branch)", () => {
  const stages = commitStages({ ...state, staging: ["q1"] });
  assert.strictEqual(stages.get("q1").kind, "queued");
});
t("the candidates of the Release tab use the same words", () => {
  assert.strictEqual(stageOfCandidate({ pending: true, in_release: "" }).kind, "staging");
  assert.deepStrictEqual(stageOfCandidate({ pending: false, in_release: "rel-1" }), { kind: "queued", name: "rel-1" });
  assert.strictEqual(stageOfCandidate({ pending: false, in_release: "" }).kind, "prod");
});
t("the pointer says where the commit is, with the names of the branches", () => {
  assert.match(stageTitle({ kind: "prod", name: "" }, "19.0", "19.0-staging"), /In 19\.0/);
  assert.match(stageTitle({ kind: "staging", name: "" }, "19.0", "19.0-staging"), /Merged into 19\.0-staging, not in 19\.0 yet/);
  assert.match(stageTitle({ kind: "queued", name: "rel-1" }, "19.0", "19.0-staging"), /rel-1.*not merged yet/);
  assert.strictEqual(stageTitle(null), "");
});
t("the search of the graph finds the words of the chip", () => {
  assert.match(stageText({ kind: "staging", name: "" }), /not in prod/i);
  assert.match(stageText({ kind: "queued", name: "x" }), /on its way/i);
  assert.strictEqual(stageText(undefined), "");
});
console.log("  " + n + " passed");
