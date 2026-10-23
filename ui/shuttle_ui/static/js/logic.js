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

// The two sides of a conflict, in words, for the buttons next to every file in conflict. null when the server does not say (an older one).
// "ours" and "theirs" are git's: the server says which branch each is (in a rebase they are the other way round from what they sound like).
export function conflictChoices(status) {
  const s = status || {};
  if (!s["conflict.ours"] || !s["conflict.theirs"]) return null;
  return {
    ours: { name: s["conflict.ours"], role: s["conflict.ours.role"] || "" },
    theirs: { name: s["conflict.theirs"], role: s["conflict.theirs.role"] || "" },
  };
}
// a name that is long (a commit with its title) is cut for a button; the whole name is in its tooltip
export const shortName = (name, max = 32) => (name.length > max ? name.slice(0, max - 1).trimEnd() + "…" : name);
export const keepLabel = side => "Keep " + shortName(side.name);
export const keepTitle = (side, other) => "Keep " + side.name + (side.role ? " (" + side.role + ")" : "") + " for this file; what " + other.name + " wrote in it is dropped";
export const conflictSidesLine = c => c.ours.name + (c.ours.role ? " is " + c.ours.role : "") + "; " + c.theirs.name + (c.theirs.role ? " is " + c.theirs.role : "") + ".";
// side: "ours" or "theirs"; the request for the preview that comes before anything is changed
export function resolveRequest(status, side, file) {
  const c = conflictChoices(status);
  const name = c ? c[side].name : side;
  return { action: "resolve", params: { side, paths: [file] }, label: "Keep " + name + " in " + file, verb: "Keep " + name };
}

// ---- a pick that waits: pick, cherry-pick and release have a plan, and  git shuttle continue  goes on with the commits that are left
export function parsePickStep(entry) {
  const [state, sha, subject, author, when] = String(entry).split("\x1f");
  return { state, sha, subject: subject || "", author: author || "", when: when || "" };
}
// where the pick stands, or null: { index, total, branch, base, push, mode, steps: [{ state: done|current|todo, sha, subject, author, when }], current }
export function pickProgress(status) {
  const s = status || {};
  const total = +s["pick.total"] || 0;
  if (!total) return null;
  const steps = (s["pick.step"] || []).map(parsePickStep);
  return { index: +s["pick.index"] || 0, total, branch: s["pick.branch"] || "", base: s["pick.base"] || "", push: s["pick.push"] === "1",
    mode: s["pick.mode"] || "", steps, current: steps.find(x => x.state === "current") || null };
}
// the release branch that was picked and waits for its pull request (only while you are on it), or null
export function releaseReady(status) {
  const s = status || {};
  return s["release.ready"] ? { branch: s["release.ready"], base: s["release.base"] || "", pushed: s["release.pushed"] === "1" } : null;
}
// the two letters git shows for a file in conflict (UU, AA: written on both sides, so it has places to choose from; DU, UD...: one side deleted it)
export function conflictCode(status, path) {
  const entry = ((status && status.file) || []).find(f => f.slice(3) === path);
  return entry ? entry.slice(0, 2) : "";
}
export const hasMarkers = code => code === "UU" || code === "AA";
// Why a file has no places to choose from, in the words of the two sides (git's letters: first the side of "ours", then the side of "theirs"):
// a file that one side deleted or never had is kept whole or left out. "" for a file that has places (UU, AA) and for what is not known.
export function conflictKindNote(code, sides) {
  if (!sides) return "";
  const o = shortName(sides.ours.name, 40), t = shortName(sides.theirs.name, 40);
  switch (code) {
    case "DU": return o + " does not have this file; " + t + " changes it. Keeping " + t + " brings the file in as that commit has it; keeping " + o + " leaves it out.";
    case "UD": return t + " deletes this file; " + o + " changes it. Keeping " + o + " keeps the file; keeping " + t + " deletes it.";
    case "UA": return t + " adds this file; " + o + " does not have it. Keeping " + t + " adds it; keeping " + o + " leaves it out.";
    case "AU": return o + " has this file; " + t + " does not. Keeping " + o + " keeps it; keeping " + t + " deletes it.";
    case "DD": return "Both sides deleted this file.";
    default: return "";
  }
}
// who last changed the lines of a side of a place: one sentence for each commit
export const blameLine = (b, total) => (b.picked ? "Commit " + b.picked + (total ? " of " + total : "") + " of this release: " : "Already on the branch: ") + b.subject
  + (b.author ? " (" + b.author + (b.when ? ", " + b.when : "") + ")" : "") + " · " + b.lines + (b.lines === 1 ? " line" : " lines");
// what a place can keep, in the words of the branches
export function hunkChoices(sides, hasBase) {
  const o = sides.ours.name, t = sides.theirs.name;
  const why = side => (side.role ? " (" + side.role + ")" : "");
  const list = [
    { id: "ours", label: "Keep " + shortName(o), title: "Only the lines of " + o + why(sides.ours) },
    { id: "theirs", label: "Keep " + shortName(t), title: "Only the lines of " + t + why(sides.theirs) },
    { id: "both", label: "Both, " + shortName(o, 24) + " first", title: "The lines of " + o + ", then the lines of " + t },
    { id: "both-reverse", label: "Both, " + shortName(t, 24) + " first", title: "The lines of " + t + ", then the lines of " + o },
  ];
  if (hasBase) list.push({ id: "base", label: "What it was before", title: "Go back to what both sides started from" });
  return list;
}
export const hunksDecided = (hunks, choices) => hunks.length > 0 && hunks.every(h => !!choices[h.n]);
// choices: { placeNumber: choice }; the request for the preview that comes before anything is written
export function resolveHunksRequest(file, choices) {
  const hunks = {};
  for (const [n, choice] of Object.entries(choices)) hunks[n] = choice;
  return { action: "resolve", params: { file, hunks }, label: "Resolve " + file + ", place by place", verb: "Write the choices" };
}

// ---- the names a new branch can start from, in the words of the settings: the prefix of task branches, the other prefixes in use, the next
// release name. A click on one fills the field; typing by hand stays as it was.
export function branchTemplates(status, branches, now = new Date()) {
  const s = status || {};
  const prefix = s["config.branchPrefix"] || "";
  const names = branchOptions(branches).map(o => o.name);
  const out = [];
  if (prefix) out.push({ kind: "prefix", label: prefix, value: prefix, title: "A task branch: the prefix of the settings, then the name of the task" });
  for (const p of prefixOptions(branches)) {
    if (out.length >= 5) break;
    if (!out.some(t => t.value === p.name)) out.push({ kind: "prefix", label: p.name, value: p.name, title: "A prefix that other branches use" });
  }
  const pattern = s["config.releasePattern"] || inferReleasePattern(names);
  if (pattern) {
    const next = releasePreview(pattern, names, now);
    if (next.name) out.push({ kind: "release", label: next.name, value: next.name, title: "The next release branch: the pattern of the settings, with the first free number" });
  }
  return out;
}

// ---- line by line: each line of either side is kept or left out; what is written is the kept lines of the left side, then those of the right
// side (or the other way round); a whole side, or both, is one click. h is a place as the server gives it (ours, theirs, base and their numbers of lines).
const linesOf = (text, count) => (count > 0 ? String(text).split("\n") : []);
export function hunkLines(h) {
  return { o: linesOf(h.ours, h.n_ours), t: linesOf(h.theirs, h.n_theirs), b: h.base === null || h.base === undefined ? null : linesOf(h.base, h.n_base) };
}
export const emptyPick = h => ({ o: Array(h.n_ours).fill(false), t: Array(h.n_theirs).fill(false), order: "ours", base: false });
export function presetPick(h, id) {
  if (id === "base") return { ...emptyPick(h), base: true };
  return { o: Array(h.n_ours).fill(id !== "theirs"), t: Array(h.n_theirs).fill(id !== "ours"), order: id === "both-reverse" ? "theirs" : "ours", base: false };
}
// a click on a line (side: "o" or "t"); the first click on a place that was not decided starts from nothing kept
export function togglePick(h, pick, side, index) {
  const next = pick && !pick.base ? { ...pick, o: pick.o.slice(), t: pick.t.slice() } : emptyPick(h);
  next[side][index] = !next[side][index];
  return next;
}
export const setOrder = (pick, order) => ({ ...pick, order });
// the lines that will be written: [{ side: "o"|"t"|"b", index, text }]
export function pickResult(h, pick) {
  const { o, t, b } = hunkLines(h);
  const make = (side, lines, flags) => lines.map((text, index) => ({ side, index, text })).filter(l => flags[l.index]);
  if (pick.base) return (b || []).map((text, index) => ({ side: "b", index, text }));
  const mine = make("o", o, pick.o), theirs = make("t", t, pick.t);
  return pick.order === "theirs" ? [...theirs, ...mine] : [...mine, ...theirs];
}
// what goes to the command: a name when the lines kept are exactly a whole side (or both), else the lines one by one
export function pickChoice(h, pick) {
  if (pick.base) return "base";
  const tokens = r => r.map(l => l.side + (l.index + 1)).join("+");
  const mine = tokens(pickResult(h, pick));
  for (const id of ["ours", "theirs", "both", "both-reverse"]) if (tokens(pickResult(h, presetPick(h, id))) === mine) return id;
  return "pick:" + mine;
}
