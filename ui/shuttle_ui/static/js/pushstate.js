/* What the Push control in the top bar shows and whether it can be used. Pure, tested with node. */

const num = value => +value || 0;

// status: the porcelain status of the repository. → { kind, label, disabled, reason, ahead, behind, branch, upstream }
//   kind: "none" (nothing to push), "publish" (no upstream yet), "push" (commits ahead), "diverged" (ahead and behind)
export function pushState(status) {
  const s = status || {};
  const state = { kind: "none", label: "", disabled: false, reason: "", ahead: 0, behind: 0, branch: s.branch || "", upstream: s.upstream || "" };
  if (!s.branch) return state;                             // a detached HEAD has nothing to publish
  state.ahead = num(s["upstream.ahead"]);
  state.behind = num(s["upstream.behind"]);
  if (!state.upstream) { state.kind = "publish"; state.label = "Publish"; }
  else if (state.ahead > 0 && state.behind > 0) { state.kind = "diverged"; state.label = "Push ↑" + state.ahead + " ↓" + state.behind; }
  else if (state.ahead > 0) { state.kind = "push"; state.label = "Push ↑" + state.ahead; }
  else return state;
  if (s.operation) { state.disabled = true; state.reason = "Finish the " + s.operation + " first."; }
  else if (s.protected === "1") { state.disabled = true; state.reason = s.branch + " is a protected branch: work on a feature branch."; }
  return state;
}

export function pushTitle(state) {
  if (state.disabled) return state.reason;
  if (state.kind === "publish") return "Publish " + state.branch + " to the remote and set its upstream";
  if (state.kind === "diverged") return state.branch + " and " + state.upstream + " have diverged: a normal push would be rejected";
  return "Push " + state.ahead + (state.ahead === 1 ? " commit" : " commits") + " to " + state.upstream;
}

// How a branch of the picker stands against its upstream: "not pushed", "upstream gone", "↑2 ↓1", or "" when in sync.
export function upstreamMarker(branch) {
  if (!branch || branch.ref === undefined || !branch.ref.startsWith("refs/heads/")) return "";
  if (!branch.upstream) return "not pushed";
  if (branch.gone) return "upstream gone";
  return [branch.ahead ? "↑" + branch.ahead : "", branch.behind ? "↓" + branch.behind : ""].filter(Boolean).join(" ");
}
