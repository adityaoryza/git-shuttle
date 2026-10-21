/* Labels for the repository list. Pure, tested with node. */

function tail(path, n) {
  return String(path).split("/").filter(Boolean).slice(-n).join("/");
}

// Two repositories can share a display name (two folders called "project"): then the label adds where each one is,
// "name — parent/folder". The full path is always the title (the tooltip).
export function repoLabels(repos) {
  const count = new Map();
  for (const r of repos) count.set(r.name, (count.get(r.name) || 0) + 1);
  return repos.map(r => ({
    id: r.id,
    label: count.get(r.name) > 1 ? r.name + " — " + tail(r.path, 2) : r.name,
    title: r.path,
  }));
}
