/* The Release tab: finding things in what was merged, picking them in order, naming the branch, and the notes for the pull request.
 * Pure, tested with node. */

// A merge is { subject, date, commits: [{ hash, subject, author, pending }] } as GET /candidates answers (newest first).

const lower = text => String(text || "").toLowerCase();

// The commits that match the search (in the message, the hash, the author, or the title of the merge they came with), and not the released
// ones when asked; a merge with nothing left is not listed.
// tasks (optional): GET /trace/map ({commits: {sha: [addon, id]}, tasks: {"addon:id": {title}}}); task: "" for any, "none" for the commits of no task,
// or "addon:id" for the commits of that task (a commit is for a task when the trace says so, else when the merge it came with is).
export const taskOf = (tasks, merge, commit) => (tasks && tasks.commits && (tasks.commits[commit.hash] || (merge.merge && tasks.commits[merge.merge]))) || null;

export function filterMerges(merges, query, hideReleased, tasks, task) {
  const words = lower(query).split(/\s+/).filter(Boolean);
  const out = [];
  for (const merge of merges) {
    const commits = merge.commits.filter(commit => {
      if (hideReleased && !commit.pending) return false;
      const own = taskOf(tasks, merge, commit);
      if (task === "none" ? own : task && (!own || own.join(":") !== task)) return false;
      const info = own && tasks.tasks ? tasks.tasks[own.join(":")] || {} : {};
      const haystack = lower(commit.subject) + " " + lower(commit.hash) + " " + lower(commit.author) + " " + lower(merge.subject) + (own ? " #" + lower(own[1]) + " " + lower(info.title) : "");
      return words.every(word => haystack.includes(word));
    });
    if (commits.length) out.push({ ...merge, commits });
  }
  return out;
}

export const pendingOf = merges => merges.flatMap(merge => merge.commits.filter(commit => commit.pending));

// The picks, in the order they were made; `more` (a list of commits) is added at the end in the order given, without repeats.
export function addPicks(picked, more) {
  const have = new Set(picked.map(p => p.hash));
  const added = more.filter(commit => commit.pending !== false && !have.has(commit.hash)).map(commit => ({ hash: commit.hash, subject: commit.subject }));
  return [...picked, ...added];
}

export const removePicks = (picked, hashes) => picked.filter(p => !hashes.includes(p.hash));

// Move the pick at `index` by `delta`; an edge stays where it is.
export function movePick(picked, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= picked.length) return picked;
  const next = picked.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// ---- the names ---------------------------------------------------------------------------------------------------------------------

const escape = text => text.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

// The pattern of Settings ("19.0-release/{yymmdd}-v1.{n}") as a regular expression for the branches that were made with it.
export function patternRegex(pattern) {
  if (!pattern) return null;
  const parts = pattern.split(/(\{date\}|\{yymmdd\}|\{n\})/);
  const source = parts.map(part => (part === "{date}" ? "\\d{8}" : part === "{yymmdd}" ? "\\d{6}" : part === "{n}" ? "\\d+" : escape(part))).join("");
  return new RegExp("^" + source + "$");
}

// Release branches that exist, newest first (the date, then the number, compared as numbers).
export function releaseBranches(pattern, names) {
  const re = patternRegex(pattern);
  if (!re) return [];
  const key = name => (name.match(/\d+/g) || []).map(Number);
  return [...new Set(names)].filter(name => re.test(name)).sort((a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); }
    return 0;
  });
}

// ---- the notes ---------------------------------------------------------------------------------------------------------------------

// "[FEAT] stock_onsite: adjust the list" → { module: "stock_onsite", summary: "adjust the list" }; without that shape the module is "Other".
export function parseSubject(subject) {
  const m = /^\[[A-Za-z]+\]\s*([^:]+?)\s*:\s*(.+)$/.exec(String(subject || "").trim());
  return m ? { module: m[1], summary: m[2] } : { module: "Other", summary: String(subject || "").trim() };
}

// Markdown for the description of the pull request: the commits by module, in the order they were picked.
export function releaseNotes(name, picked) {
  const groups = new Map();
  for (const pick of picked) {
    const { module, summary } = parseSubject(pick.subject);
    if (!groups.has(module)) groups.set(module, []);
    groups.get(module).push("- " + summary + " (" + String(pick.hash).slice(0, 7) + ")");
  }
  const lines = ["## Release " + name, ""];
  for (const [module, items] of groups) lines.push("### " + (module === "Other" ? "Other" : "`" + module + "`"), ...items, "");
  return lines.join("\n").trimEnd() + "\n";
}

// What the main button of the tab does with the state of the tab.
export function releaseAction({ picked, target, name, push, strategy }) {
  const count = picked.length;
  if (target) {
    return count
      ? { action: "release", label: "Add " + count + " commit" + (count === 1 ? "" : "s") + " to " + target, params: { onto: target, append: true, commits: picked.map(p => p.hash), push, strategy: strategy || undefined } }
      : { action: null, label: "Add commits to " + target, params: null };
  }
  if (!count) return { action: "release", label: "Create the release branch (no commits yet)", params: { onto: name || "auto", empty: true, push } };
  return { action: "release", label: "Create the release branch with " + count + " commit" + (count === 1 ? "" : "s"), params: { onto: name || "auto", commits: picked.map(p => p.hash), push, strategy: strategy || undefined } };
}
