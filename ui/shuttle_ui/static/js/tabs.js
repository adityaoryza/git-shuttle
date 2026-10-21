/* Which tab fits where you are, and what the Start tab should offer. Pure, tested with node. */
import { branchFromName } from "./logic.js";

const num = value => +value || 0;

// What the status says about the working tree and the branch, as numbers.
export function hereOf(status) {
  const s = status || {};
  const tracked = num(s.staged) + num(s.unstaged);
  return {
    branch: s.branch || "",
    detached: !s.branch,
    protectedBranch: s.protected === "1",
    tracked, untracked: num(s.untracked), changes: tracked + num(s.untracked),
    ahead: num(s["integration.ahead"]), behind: num(s["integration.behind"]),
    integrationRef: s["integration.ref"] || "", merged: s.merged === "1",
    operation: s.operation || "",
  };
}

// On the integration branch → start a task; on a task branch with work to send → ship it.
export function suggestTab(status) {
  if (!status) return "start";
  const here = hereOf(status);
  if (here.operation) return "ship";
  if (here.protectedBranch) return "start";
  if (here.changes > 0 || (here.ahead > 0 && !here.merged)) return "ship";
  return "start";
}

// "feature/x" exists as a local branch, or only on the remote, or not at all.
export function existingBranch(branch, branches) {
  if (!branch || !branches) return null;
  if ((branches.local || []).some(b => b.name === branch)) return "local";
  if ((branches.remote || []).some(b => b.name.replace(/^[^/]+\//, "") === branch)) return "remote";
  return null;
}

// Everything the Start tab shows, from the status, the branches, what is typed and the choice for uncommitted changes.
export function startPlan({ status, branches, name, prefix, choice }) {
  const here = hereOf(status);
  const branch = branchFromName(name, prefix || "feature/");
  const exists = existingBranch(branch, branches);
  const onTask = !here.protectedBranch && !here.detached && (here.changes > 0 || here.ahead > 0);
  const params = { name };
  if (here.tracked > 0) params[choice === "carry" ? "carry" : "stash"] = true;
  return {
    here, branch, exists, onTask, params,
    needsChoice: here.tracked > 0,
    canCreate: !!branch && !exists && !here.operation,
  };
}

// One line about where you are: the branch, how far it is from the integration branch, and the uncommitted changes.
export function whereLine(here) {
  if (here.detached) return "You are not on a branch (detached HEAD).";
  const parts = [];
  if (here.integrationRef) parts.push("↑" + here.ahead + " ↓" + here.behind + " vs " + here.integrationRef);
  parts.push(here.changes ? here.changes + (here.changes === 1 ? " uncommitted change" : " uncommitted changes") : "no uncommitted changes");
  return "You are on " + here.branch + " · " + parts.join(" · ");
}

// What creating the branch will do, in a sentence.
export function willDo(here, branch, from, choice) {
  const base = "The new branch is cut from " + (from || "the integration branch") + (branch ? " as " + branch : "") + ".";
  if (here.tracked === 0) return base;
  return base + (choice === "carry" ? " Your uncommitted changes come along." : " Your uncommitted changes go to the stash first.");
}

// A refused preview of `start` because of uncommitted changes: the way out is one of the two choices.
export function refusedForChanges(shown) {
  return !!(shown && shown.action === "start" && !shown.ok && /uncommitted changes/.test(shown.steps.map(s => s.output).join("\n")));
}
