/* Grouping branches into folders for the picker. Pure, tested with node. */

// "origin/19.0-feature/x" → folder "19.0-feature", leaf "x" (the remote name is not a folder); no "/" → no folder
export function folderOf(branch) {
  const parts = branch.name.split("/");
  const skip = branch.ref.startsWith("refs/remotes/") ? 1 : 0;
  const rest = parts.slice(skip);
  return rest.length > 1 ? { folder: (skip ? parts[0] + "/" : "") + rest[0], leaf: rest.slice(1).join("/") } : { folder: "", leaf: branch.name };
}

export function groupBranches(list) {
  const root = [], folders = new Map();
  for (const b of list) {
    const { folder, leaf } = folderOf(b);
    if (!folder) { root.push({ b, leaf }); continue; }
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ b, leaf });
  }
  return { root, folders: [...folders.entries()] };
}
