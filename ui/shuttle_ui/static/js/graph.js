/* The commit graph layout: which column each commit sits in and which lines to draw in each row. Pure, tested with node.
 *
 * Input: commits newest first (topological order), each { sha, parents: [sha] }.
 * Output: one row per commit: { col, above, below, joins, forks, cols } where
 *   above/below  the lanes (a sha per column, or null) entering and leaving the row,
 *   joins        columns whose lane ends in this commit (draw from the top of the row to the node),
 *   forks        columns the commit's parents continue in (draw from the node to the bottom of the row),
 *   cols         the widest the graph gets up to this row (for the width of the drawing).
 */
export function layout(commits) {
  let lanes = [];
  const rows = [];
  let width = 1;
  for (const commit of commits) {
    const above = lanes.slice();
    let col = lanes.indexOf(commit.sha);
    if (col < 0) {
      col = lanes.indexOf(null);
      if (col < 0) { col = lanes.length; lanes.push(null); }
      lanes[col] = commit.sha;
    }
    const joins = [];
    lanes.forEach((sha, i) => { if (sha === commit.sha) joins.push(i); });
    const forks = [];
    lanes = lanes.map(sha => (sha === commit.sha ? null : sha));
    commit.parents.forEach((parent, n) => {
      let at = lanes.indexOf(parent);
      if (at < 0) {
        at = n === 0 && lanes[col] === null ? col : lanes.indexOf(null);
        if (at < 0) { at = lanes.length; lanes.push(null); }
        lanes[at] = parent;
      }
      if (!forks.includes(at)) forks.push(at);
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, above.length, lanes.length, col + 1);
    rows.push({ sha: commit.sha, col, above, below: lanes.slice(), joins, forks, cols: width });
  }
  return { rows, width };
}

/* Branch and tag labels from `git log --format=%D`: "HEAD -> feature/x", "origin/main", "tag: v1".
 * A remote branch is "<remote>/<branch>": `remotes` is the list of remote names of the repository. */
export function parseRefs(refs, remotes) {
  const out = [];
  for (const raw of refs || []) {
    if (raw === "HEAD") { out.push({ name: "HEAD", kind: "head", current: true }); continue; }
    const current = raw.startsWith("HEAD -> ");
    const name = current ? raw.slice(8) : raw;
    if (name.startsWith("tag: ")) out.push({ name: name.slice(5), kind: "tag", current: false });
    else if (!current && (remotes || []).includes(name.split("/")[0])) {
      if (!name.endsWith("/HEAD")) out.push({ name, kind: "remote", current: false });
    } else out.push({ name, kind: "local", current });
  }
  return out;
}

export function relativeTime(seconds, now) {
  const diff = Math.max(0, (now || Date.now() / 1000) - seconds);
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [label, size] of units) if (diff >= size) return Math.floor(diff / size) + label + " ago";
  return "just now";
}

// "2026-10-21 14:05" in the local time zone; and the exact ISO time for a tooltip.
const two = n => String(n).padStart(2, "0");
export function absoluteTime(seconds) {
  const d = new Date(seconds * 1000);
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
}
export const isoTime = seconds => (seconds ? new Date(seconds * 1000).toISOString() : "");

// Two letters for the badge of an author: "Agung Prayogi" → "AP", "agungprygi" → "AG", "" → "?".
export function initials(name) {
  const words = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[words.length - 1])[0]];
  return letters.join("").toUpperCase();
}
// A stable colour per person (a dark one, so that the white letters keep their contrast on both themes).
export function hueOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// The rows of the graph table: every commit with its lanes and labels, and the working tree row on top when there are changes.
export function graphRows(commits, remotes, changes) {
  const { rows: lanes, width } = layout(commits);
  const rows = commits.map((commit, i) => ({ key: commit.sha, commit, lane: { ...lanes[i], parents: commit.parents.length }, refs: parseRefs(commit.refs, remotes) }));
  if (changes > 0) rows.unshift({ key: "worktree", wip: true, changes });
  return { rows, width };
}
