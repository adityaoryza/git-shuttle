/* Pure logic of the git-shuttle UI: no DOM, no network. Tested with node. */

// The same snake_case the CLI makes for `git shuttle start`.
export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function branchFromName(name, prefix) {
  prefix = prefix || "feature/";
  const bare = String(name).startsWith(prefix) ? String(name).slice(prefix.length) : String(name);
  const s = slug(bare);
  return s ? prefix + s : "";
}

// "XY path" as printed by `git status --porcelain`; the status codes are two characters.
export function parseFileEntry(entry) {
  const code = entry.slice(0, 2);
  const path = entry.slice(3);
  const x = code[0], y = code[1];
  return {
    code, path,
    staged: x !== " " && x !== "?" && x !== "!",
    untracked: code === "??",
    unmerged: x === "U" || y === "U" || code === "AA" || code === "DD",
    label: code === "??" ? "?" : (x !== " " ? x : y),
  };
}

// The module of a path: its first folder; files at the root form the group "(root)".
export function moduleOf(path) {
  return String(path).includes("/") ? String(path).split("/")[0] : "(root)";
}

// Files grouped by module: the first folder of the path; files at the root form one group of their own.
export function groupByModule(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const file = parseFileEntry(entry);
    const key = moduleOf(file.path);
    if (!groups.has(key)) groups.set(key, { module: key, files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.values()].sort((a, b) => a.module.localeCompare(b.module));
}

// Why a commit message would be refused; "" when it is fine. The CLI has the last word: this only warns while typing.
export function messageProblem(message, cfg) {
  const lines = String(message).split("\n").filter(l => !l.startsWith("#"));
  const subject = (lines.find(l => l.trim() !== "") || "").trimEnd();
  if (!subject) return "the message is empty";
  if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject)) return "";
  const pattern = cfg && cfg.messagePattern;
  if (pattern) {
    let re = null;
    try { re = new RegExp(pattern); } catch (e) { re = null; }   // an ERE the browser cannot read: the CLI decides
    if (re && !re.test(subject)) return "the first line does not match " + pattern;
  }
  const trailers = ((cfg && cfg.forbidTrailers) || "").split(/\s+/).filter(Boolean);
  for (const t of trailers) {
    if (!/^[A-Za-z0-9-]+$/.test(t)) continue;
    const re = new RegExp("^\\s*" + t + ":", "im");
    if (re.test(message)) return "a '" + t + ":' line is not allowed";
  }
  return "";
}

// The test command with {modules} filled in: shown to be copied, never run.
export function upgradeCommand(template, groups) {
  if (!template) return "";
  const modules = groups.map(g => g.module).filter(m => m !== "(root)").join(",");
  return template.replace(/\{modules\}/g, modules);
}

// The request for `ship`: one commit per included group, in the order shown.
export function shipParams(groups, how) {
  const commits = groups.filter(g => g.include).map(g => ({
    message: g.message,
    paths: g.files.map(f => f.path),
  }));
  const params = { commits };
  if (how && how.pr) {
    params.pr = true;
    if (how.title) params.title = how.title;
    if (how.body) params.body = how.body;
    if (how.draft) params.draft = true;
  }
  return params;
}

// Untracked files of the groups that are included: they need `stage` before a commit.
export function pathsToStage(groups) {
  const paths = [];
  for (const g of groups) if (g.include) for (const f of g.files) if (f.untracked) paths.push(f.path);
  return paths;
}

export function tagOf(message) {
  const m = /^\[([A-Z]+)\]/.exec(message);
  return m ? m[1] : "";
}

export function shortHash(h) { return String(h).slice(0, 7); }

// A pull request is opened with the GitHub CLI: without it the page says so, and what to do, before anything is tried.
export const GH_MISSING = {
  title: "The GitHub CLI (gh) is not installed",
  text: "A pull request is opened with gh. Install it (brew install gh, winget install GitHub.cli, or your package manager) and run gh auth login. Or merge instead, or push the branch and open the pull request on the hosting site.",
};
export const ghMissing = status => !!status && status.gh === "0";

// ---- branch names for the settings: pick what exists, and see the release name before saving ------------------------

// Names of the branches that exist, local and remote, without the remote prefix, sorted; each with where it is.
export function branchOptions(branches) {
  const byName = new Map();
  for (const b of (branches && branches.local) || []) byName.set(b.name, { name: b.name, where: "local" });
  for (const b of (branches && branches.remote) || []) {
    const name = b.name.replace(/^[^/]+\//, "");
    if (!byName.has(name)) byName.set(name, { name, where: "remote" });
    else byName.get(name).where = "local + remote";
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Prefixes in use ("19.0-feature/"): the first folder of every branch name that has one.
export function prefixOptions(branches) {
  const set = new Set();
  for (const o of branchOptions(branches)) if (o.name.includes("/")) set.add(o.name.split("/")[0] + "/");
  return [...set].sort().map(name => ({ name, where: "in use" }));
}

// Matches of what is typed: a name that starts with it first, then names that contain it.
export function matchOptions(options, query, limit = 50) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const starts = options.filter(o => o.name.toLowerCase().startsWith(q));
  const has = options.filter(o => !o.name.toLowerCase().startsWith(q) && o.name.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}

// The task branch prefix is glued to the task name: without a closing slash "19.0-feature" + "x" would be "19.0-featurex".
export function normalizePrefix(prefix) {
  const p = String(prefix || "").trim();
  return p && !p.endsWith("/") ? p + "/" : p;
}

const pad2 = n => String(n).padStart(2, "0");
export function dateParts(now) {
  const d = now || new Date();
  const date = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  return { date, yymmdd: date.slice(2) };
}

export const DEFAULT_RELEASE_PATTERN = "release/{date}-v1.{n}";

// The name `git shuttle release --onto auto` would give: the same rules as the CLI (the first free {n}, from 0).
// Returns { name } or { error }.
export function releasePreview(pattern, existingNames, now) {
  const p = pattern || DEFAULT_RELEASE_PATTERN;
  const { date, yymmdd } = dateParts(now);
  const taken = new Set(existingNames || []);
  for (let n = 0; n < 100; n++) {
    const name = p.split("{date}").join(date).split("{yymmdd}").join(yymmdd).split("{n}").join(String(n));
    if (taken.has(name)) {
      if (!p.includes("{n}")) return { error: "the release branch '" + name + "' already exists" };
      continue;
    }
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (taken.has(parent)) return { error: "a branch called '" + parent + "' exists, and branch names do not nest" };
    }
    return { name };
  }
  return { error: "no free name for this pattern" };
}

// A pattern read from release branches that already exist: "19.0-release/261021-v1.0" → "19.0-release/{yymmdd}-v1.{n}".
// The newest one wins (the largest date, then the largest number).
export function inferReleasePattern(names) {
  let best = null;
  for (const name of names || []) {
    const m = /^(.*?)(\d{8}|\d{6})(-?v?\d+\.)(\d+)((?:\.\d+)?)$/.exec(name);
    if (!m || !/release/i.test(m[1])) continue;
    const key = [m[2].length === 6 ? "20" + m[2] : m[2], Number(m[4])];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) {
      best = { key, pattern: m[1] + (m[2].length === 6 ? "{yymmdd}" : "{date}") + m[3] + "{n}" + m[5] };
    }
  }
  return best ? best.pattern : "";
}
