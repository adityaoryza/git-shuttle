/* The files of a commit as a list or as a tree. Pure, tested with node. */

export const STATUS_NAMES = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed", U: "conflict", "?": "untracked" };

// A tree of folders and files; a folder with a single folder inside is shown as one line ("a/b/c").
export function buildTree(files) {
  const root = { name: "", path: "", dir: true, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find(c => c.name === part && c.dir === !last);
      if (!child) {
        child = last ? { name: part, path, dir: false, file } : { name: part, path, dir: true, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const tidy = node => {
    if (!node.dir) return node;
    node.children = node.children.map(tidy).sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    while (node !== root && node.children.length === 1 && node.children[0].dir) {
      const only = node.children[0];
      node.name += "/" + only.name; node.path = only.path; node.children = only.children;
    }
    return node;
  };
  tidy(root);
  return root;
}

// The rows to draw: [{ node, depth }]; the folders in `closed` (a set of paths) hide what they hold.
export function flattenTree(root, closed) {
  const rows = [];
  const walk = (node, depth) => {
    for (const child of node.children) {
      rows.push({ node: child, depth });
      if (child.dir && !(closed && closed.has(child.path))) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

// The files in the order they are shown: the order of j / k.
export function orderedFiles(files, mode) {
  if (mode !== "tree") return files;
  return flattenTree(buildTree(files)).filter(r => !r.node.dir).map(r => r.node.file);
}

export function filterFiles(files, query) {
  const q = String(query || "").trim().toLowerCase();
  return q ? files.filter(f => f.path.toLowerCase().includes(q) || (f.old_path || "").toLowerCase().includes(q)) : files;
}

export function totals(files) {
  let additions = 0, deletions = 0;
  for (const f of files) { additions += f.additions || 0; deletions += f.deletions || 0; }
  return { files: files.length, additions, deletions };
}

export function sameFile(a, b) {
  return !!a && !!b && a.path === b.path && (a.group || "") === (b.group || "");
}
