/* Pure logic of the git-shuttle UI: no DOM, no network. It is loaded by the page and tested with node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShuttleLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The same snake_case the CLI makes for `git shuttle start`.
  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function branchFromName(name, prefix) {
    prefix = prefix || "feature/";
    const bare = String(name).startsWith(prefix) ? String(name).slice(prefix.length) : String(name);
    const s = slug(bare);
    return s ? prefix + s : "";
  }

  // "XY path" as printed by `git status --porcelain`; the status codes are two characters.
  function parseFileEntry(entry) {
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

  // Files grouped by module: the first folder of the path; files at the root form one group of their own.
  function groupByModule(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const file = parseFileEntry(entry);
      const key = file.path.includes("/") ? file.path.split("/")[0] : "(root)";
      if (!groups.has(key)) groups.set(key, { module: key, files: [] });
      groups.get(key).files.push(file);
    }
    return [...groups.values()].sort((a, b) => a.module.localeCompare(b.module));
  }

  // Why a commit message would be refused; "" when it is fine. The CLI has the last word: this only warns while typing.
  function messageProblem(message, cfg) {
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
  function upgradeCommand(template, groups) {
    if (!template) return "";
    const modules = groups.map(g => g.module).filter(m => m !== "(root)").join(",");
    return template.replace(/\{modules\}/g, modules);
  }

  // The request for `ship`: one commit per included group, in the order shown.
  function shipParams(groups, how) {
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
  function pathsToStage(groups) {
    const paths = [];
    for (const g of groups) if (g.include) for (const f of g.files) if (f.untracked) paths.push(f.path);
    return paths;
  }

  function tagOf(message) {
    const m = /^\[([A-Z]+)\]/.exec(message);
    return m ? m[1] : "";
  }

  function shortHash(h) { return String(h).slice(0, 7); }

  return { slug, branchFromName, parseFileEntry, groupByModule, messageProblem, upgradeCommand, shipParams, pathsToStage, tagOf, shortHash };
});
