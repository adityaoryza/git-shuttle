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
