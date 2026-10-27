/* Where a commit is on its way to production, for the graph, the details and the Release tab. Pure, tested with node.
 *
 * state is what GET /release-state answers: { set, prod: [sha], staging: [sha], queued: { sha: release branch }, equivalent: [sha] }.
 * A commit is "prod" when the release branch has it, or has the same patch under another hash (a cherry-pick); "queued" when a release branch
 * that is not merged yet has it; "staging" when it is merged into the integration branch and nowhere else. Any other commit says nothing. */

export const STAGE_LABEL = { prod: "In prod", queued: "On its way", staging: "Not in prod" };

export function commitStages(state) {
  const out = new Map();
  if (!state || !state.set) return out;
  for (const sha of state.prod || []) out.set(sha, { kind: "prod", name: "" });
  for (const sha of state.equivalent || []) out.set(sha, { kind: "prod", name: "" });
  for (const sha of state.staging || []) out.set(sha, { kind: "staging", name: "" });
  for (const [sha, name] of Object.entries(state.queued || {})) out.set(sha, { kind: "queued", name });
  return out;
}

// What the pointer says on a chip.
export function stageTitle(stage, release, integration) {
  if (!stage) return "";
  if (stage.kind === "prod") return "In " + (release || "the release branch") + " (or its patch is)";
  if (stage.kind === "queued") return "In " + stage.name + ", a release branch whose pull request is not merged yet";
  return "Merged into " + (integration || "the integration branch") + ", not in " + (release || "the release branch") + " yet";
}

// The Release tab knows it from /candidates: { pending, in_release } → the same words.
export const stageOfCandidate = commit => (commit.pending ? { kind: "staging", name: "" } : commit.in_release ? { kind: "queued", name: commit.in_release } : { kind: "prod", name: "" });

// Text for the search box of the graph: "prod", "queued", "staging".
export const stageText = stage => (stage ? STAGE_LABEL[stage.kind] + " " + stage.kind : "");
