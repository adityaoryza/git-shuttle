/* Where the commits of each task are on their way to production, for the Release view of the Tasks dialog. Pure, tested with node.
 *
 * data is what GET /trace/status answers: { release, integration, open: [name], tasks: [{ addon, id, title, branches, last,
 * counts: { prod, release, staging, branch, missing }, commits: [{ sha, subject, state, where, match, as }] }] }.
 * A commit is "prod" when the release line has it (itself, the same patch, or picked by hand: same author, date and subject), "release"
 * when a release branch that is not merged yet has it, "staging" when only the integration branch has it, "branch" when only its branch does.
 * A task may need other tasks released first (`needs`, from `git shuttle trace link ID --needs OTHER`; `needed_by` is the other side), and a
 * commit that is only on the integration branch has `pos`, its place there (oldest first). */

export const STATES = ["prod", "release", "staging", "branch", "missing"];
export const STATE_LABEL = { prod: "In prod", release: "On its way", staging: "Not in prod", branch: "Not merged", missing: "Not here" };
export const STATE_TONE = { prod: "ok", release: "info", staging: "warn", branch: "neutral", missing: "neutral" };

// A task still has work to release when one of its commits is not in prod (a commit that is not in this repository does not count).
export const toRelease = task => STATES.some(s => s !== "prod" && s !== "missing" && ((task.counts || {})[s] || 0) > 0);

// The tasks to show: "todo" keeps the ones with work to release, "all" every task; then the text filter on the id, the title and the branches.
export function taskRows(data, show, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return ((data && data.tasks) || []).filter(task => {
    if (show === "todo" && !toRelease(task)) return false;
    const haystack = [task.id, task.title, ...(task.branches || [])].join(" ").toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

// The parts of the progress bar of a task: one per state that has commits, with its share in percent (they add up to 100).
export function segments(counts) {
  const c = counts || {};
  const total = STATES.reduce((sum, s) => sum + (c[s] || 0), 0);
  if (!total) return [];
  return STATES.filter(s => c[s]).map(s => ({ state: s, n: c[s], pct: Math.round((c[s] * 1000) / total) / 10 }));
}

// One line that says the same as the bar, for a screen reader and the tooltip: "3 in prod, 4 not in prod".
export const countsText = counts => segments(counts).map(p => p.n + " " + STATE_LABEL[p.state].toLowerCase()).join(", ") || "no commit traced";

// What the row of a commit adds after its subject: how it reached the release line, or which release branch has it.
export function commitNote(commit) {
  const short = String(commit.as || "").slice(0, 8);
  if (commit.state === "release") return "in " + commit.where;
  if (commit.match === "picked") return "picked by hand as " + short + " (same author, date and subject, another change)";
  if (commit.match === "patch" && commit.as !== commit.sha) return "as " + short;
  if (commit.state === "missing") return "this commit is not in this repository";
  return "";
}

// The commits of the tasks that are merged and not released yet, oldest task first: what a release would still have to pick.
export const leftToPick = tasks => (tasks || []).flatMap(task => (task.commits || []).filter(c => c.state === "staging").map(c => ({ task: task.id, sha: c.as || c.sha, subject: c.subject, pos: c.pos })));

// The task and every task it needs, directly or through another one, that this status has (a loop is followed once).
export function chainOf(tasks, task) {
  const byId = new Map((tasks || []).filter(t => t.addon === task.addon).map(t => [t.id, t]));
  const out = [], todo = [task];
  while (todo.length) {
    const t = todo.shift();
    if (!t || out.includes(t)) continue;
    out.push(t);
    for (const id of t.needs || []) todo.push(byId.get(id));
  }
  return out;
}

// What the Release button of a task picks: its commits and those of the tasks it needs that are merged and not in prod, in the order of the
// integration branch (a pick in another order may not apply).
export const chainToPick = (tasks, task) => leftToPick(chainOf(tasks, task)).sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity));

// The commits the Release button of a task takes from the tasks it needs (merged, not in prod), in the order of the integration branch:
// [{ task, commit }], to show them under the task's own commits.
export const neededCommits = (tasks, task) => chainOf(tasks, task).slice(1)
  .flatMap(t => (t.commits || []).filter(c => c.state === "staging").map(commit => ({ task: t.id, commit })))
  .sort((a, b) => (a.commit.pos ?? Infinity) - (b.commit.pos ?? Infinity));

// The totals of the tasks shown, for the line above the list.
export function totals(tasks) {
  const out = Object.fromEntries(STATES.map(s => [s, 0]));
  for (const task of tasks || []) for (const s of STATES) out[s] += (task.counts || {})[s] || 0;
  return out;
}
