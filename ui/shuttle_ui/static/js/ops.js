/* Every action of the page: its label, why it is unavailable (the same refusals as the command line, shown before you ask), the
 * form it needs, and the request it makes. Pure functions, tested with node; main.js only carries them out.
 *
 * ctx:  { status, branches, busy, pushed (Set of commit ids that a remote has), headSha, commits (id -> commit) }
 * args: what the action is about: { commit, branch, name, ... }
 */
import { branchTemplates } from "./logic.js";
const num = value => +value || 0;
const short = sha => (sha || "").slice(0, 7);

export const operationName = op => (op === "am" ? "patch" : op);
const branchOf = ctx => (ctx.status && ctx.status.branch) || "";
const dirtyTracked = ctx => !!ctx.status && num(ctx.status.staged) + num(ctx.status.unstaged) > 0;
const anyChange = ctx => !!ctx.status && num(ctx.status.staged) + num(ctx.status.unstaged) + num(ctx.status.untracked) > 0;
const isProtected = ctx => !!ctx.status && ctx.status.protected === "1";

// ---- the reasons an action is unavailable; "" means it is available
export function busy(ctx) {
  if (ctx.busy) return "another action is running";
  const op = ctx.status && ctx.status.operation;
  return op ? "finish the " + operationName(op) + " first" : "";
}
const onBranch = ctx => (branchOf(ctx) ? "" : "you are not on a branch");
const unprotected = ctx => (isProtected(ctx) ? branchOf(ctx) + " is protected: work on a feature branch" : "");
const cleanTree = ctx => (dirtyTracked(ctx) ? "commit or stash your changes first" : "");
const first = (...checks) => ctx => { for (const check of checks) { const reason = check(ctx); if (reason) return reason; } return ""; };
const rewriting = first(busy, onBranch, unprotected, cleanTree);

// the commits between a commit and the tip of the branch (oldest first), following first parents; null when the commit is not on that line
export function lineFrom(ctx, sha) {
  const out = [];
  for (let c = ctx.commits && ctx.commits.get(ctx.headSha), guard = 0; c && guard < 5000; guard++) {
    out.push(c);
    if (c.sha === sha) return out.reverse();
    c = ctx.commits.get(c.parents[0]);
  }
  return null;
}
// why a commit cannot be rewritten (dropped, moved, reset away): it, or one after it, is on a remote, or it is not on this branch
export function history(ctx, sha, { includeSelf = true } = {}) {
  const line = lineFrom(ctx, sha);
  if (!line) return "this commit is not on the branch you are on, or is too far back";
  const range = includeSelf ? line : line.slice(1);
  if (range.some(c => c.parents.length > 1)) return "a merge commit is in the way: only straight history can be rewritten";
  const onRemote = range.find(c => ctx.pushed && ctx.pushed.has(c.sha));
  return onRemote ? short(onRemote.sha) + " is on a remote: rewriting it needs a force push" : "";
}

// every commit that a remote branch reaches (breadth first over the parents the graph knows)
export function pushedShas(commits, remotes) {
  const by = new Map(commits.map(c => [c.sha, c]));
  const stack = commits.filter(c => c.refs.some(r => remotes.some(name => r.startsWith(name + "/") || r.includes("refs/remotes/" + name + "/")))).map(c => c.sha);
  const seen = new Set();
  while (stack.length) {
    const sha = stack.pop();
    if (seen.has(sha)) continue;
    seen.add(sha);
    const c = by.get(sha);
    if (c) c.parents.forEach(p => !seen.has(p) && stack.push(p));
  }
  return seen;
}

// ---- forms
const BRANCH_OK = /^[A-Za-z0-9._/-]{1,200}$/;
export const validBranchName = name => BRANCH_OK.test(name) && !name.startsWith("-") && !name.startsWith("/") && !name.endsWith("/") && !name.endsWith(".") && !name.endsWith(".lock") && !name.includes("..") && !name.includes("//") && !name.includes("/.");
export function formProblem(fields, values) {
  for (const f of fields) {
    const v = values[f.name];
    if (f.required && !String(v == null ? "" : v).trim()) return f.label + " is required";
    if (f.type === "typed" && v !== f.expect) return "type " + f.expect + " to confirm";
    if (f.branchName && String(v || "").trim() && !validBranchName(String(v).trim())) return f.label + " is not a valid branch name";
    if (f.absolute && String(v || "").trim() && !String(v).trim().startsWith("/")) return f.label + " must be an absolute path (starting with /)";
  }
  return "";
}
export const initialValues = fields => Object.fromEntries(fields.map(f => [f.name, f.value === undefined ? (f.type === "checkbox" ? false : "") : f.value]));

const localBranch = (ctx, name) => ((ctx.branches && ctx.branches.local) || []).find(b => b.name === name);

// ---- the actions. The key is the id of shuttle_ui/actions.py; a test keeps both lists the same.
export const OPS = {
  "fetch": { label: "Fetch", special: "fetch", reason: busy },
  "pull": { label: "Pull (fast-forward)",
    reason: first(busy, onBranch, ctx => (ctx.status.upstream ? "" : "this branch has no upstream: publish it first"), cleanTree),
    request: ctx => ({ action: "pull", params: { mode: "ff" }, label: "Pull " + branchOf(ctx), verb: "Pull" }),
  },
  "pull-rebase": { label: "Pull and rebase",
    reason: first(busy, onBranch, unprotected, ctx => (ctx.status.upstream ? "" : "this branch has no upstream: publish it first"), cleanTree),
    request: ctx => ({ action: "pull", params: { mode: "rebase" }, label: "Pull and rebase " + branchOf(ctx), verb: "Rebase" }),
  },
  "pull-merge": { label: "Pull and merge",
    reason: first(busy, onBranch, unprotected, ctx => (ctx.status.upstream ? "" : "this branch has no upstream: publish it first"), cleanTree),
    request: ctx => ({ action: "pull", params: { mode: "merge" }, label: "Pull and merge into " + branchOf(ctx), verb: "Merge" }),
  },
  "update-branch": { label: (ctx, a) => "Update " + (a && a.branch ? a.branch.name : "a branch") + " without checking it out",
    reason: (ctx, a) => busy(ctx) || (a.branch.current ? "this is the branch you are on: use Pull" : !a.branch.upstream ? "it has no upstream" : a.branch.gone ? "its upstream is gone" : !a.branch.behind ? "it is up to date" : a.branch.ahead ? "it has commits of its own: check it out to rebase or merge" : ""),
    request: (ctx, a) => ({ action: "pull", params: { mode: "ff", branch: a.branch.name }, label: "Update " + a.branch.name, verb: "Update" }),
  },
  "sync": {
    label: ctx => "Update from " + ((ctx.status && ctx.status["integration.ref"]) || "the integration branch"),
    reason: first(busy, onBranch, unprotected, cleanTree, ctx => (ctx.status["integration.ref"] ? "" : "no integration branch is set: see Settings")),
    request: ctx => ({ action: "sync", params: {}, label: "Rebase " + branchOf(ctx) + " on " + ctx.status["integration.ref"], verb: "Rebase" }),
  },
  "sync-merge": {
    label: ctx => "Merge " + ((ctx.status && ctx.status["integration.ref"]) || "the integration branch") + " into this branch",
    reason: first(busy, onBranch, unprotected, cleanTree, ctx => (ctx.status["integration.ref"] ? "" : "no integration branch is set: see Settings")),
    request: ctx => ({ action: "sync", params: { merge: true }, label: "Merge " + ctx.status["integration.ref"] + " into " + branchOf(ctx), verb: "Merge" }),
  },
  "push": { label: "Push", special: "push", reason: busy },
  "push-force": { label: "Force push (with lease)", special: "push", reason: busy },
  "start": { label: "Start a task", special: "start", reason: busy },
  "switch": { label: "Switch branch",
    reason: (ctx, a) => busy(ctx) || (a.name === branchOf(ctx) ? "you are on it" : ""),
    request: (ctx, a) => ({ action: "switch", params: { name: a.name }, label: "Switch to " + a.name, verb: "Switch" }),
  },
  "branch": {
    label: (ctx, a) => (a && a.commit ? "Create a branch here…" : "New branch"),
    reason: busy,
    form: (ctx, a) => [
      { name: "name", label: "Branch name", type: "text", mono: true, required: true, branchName: true, placeholder: ((ctx.status && ctx.status["config.branchPrefix"]) || "feature/") + "my_task", templates: branchTemplates(ctx.status, ctx.branches, new Date()), autofocus: true, hint: a && a.commit ? "At " + short(a.commit.sha) + " " + a.commit.subject : "At the commit you are on" },
      { name: "push", label: "Push to the remote and set the upstream", type: "checkbox", remember: "pushNewBranch" },
    ],
    request: (ctx, a, v) => ({ action: "branch", params: { name: v.name.trim(), ...(a && a.commit ? { commit: a.commit.sha } : {}), push: !!v.push }, label: "Create branch " + v.name.trim(), verb: v.push ? "Create and push" : "Create branch" }),
  },
  "rename": { label: "Rename branch",
    reason: (ctx, a) => busy(ctx) || (ctx.protectedNames && ctx.protectedNames.includes(a.branch.name) ? a.branch.name + " is protected" : ""),
    form: (ctx, a) => [
      { name: "new", label: "New name", type: "text", mono: true, required: true, branchName: true, value: a.branch.name, autofocus: true },
      ...(a.branch.upstream ? [{ name: "remote", label: "Rename it on " + a.branch.upstream.split("/")[0] + " too", type: "checkbox", hint: "the new name is pushed and the old one deleted there" }] : []),
    ],
    request: (ctx, a, v) => ({ action: "rename", params: { old: a.branch.name, new: v.new.trim(), remote: !!v.remote }, label: "Rename " + a.branch.name + " to " + v.new.trim(), verb: "Rename" }),
  },
  "delete": { label: "Delete branch",
    reason: (ctx, a) => busy(ctx) || (a.branch.current ? "you are on it: switch away first" : ctx.protectedNames && ctx.protectedNames.includes(a.branch.name) ? a.branch.name + " is protected" : ""),
    form: (ctx, a) => [{ name: "force", label: "Delete it even if its commits are not merged anywhere", type: "checkbox", hint: "Without this, git refuses when commits would only be reachable from the reflog." }],
    request: (ctx, a, v) => ({ action: "delete", params: { name: a.branch.name, force: !!v.force }, label: "Delete " + a.branch.name, verb: "Delete", tone: "destructive" }),
  },
  "delete-remote": { label: "Delete branch on the remote",
    reason: (ctx, a) => busy(ctx) || (ctx.protectedNames && ctx.protectedNames.includes(a.name) ? a.name + " is protected" : ""),
    request: (ctx, a) => ({ action: "delete", params: { name: a.name, remote: true }, label: "Delete " + a.name + " on the remote", verb: "Delete on the remote", tone: "destructive" }),
  },
  "upstream": { label: "Set or remove the upstream",
    reason: busy,
    form: (ctx, a) => [{ name: "set", label: "Follow", type: "select", value: a.branch.upstream || "", options: [{ value: "", label: "(no upstream)" }, ...((ctx.branches && ctx.branches.remote) || []).map(b => ({ value: b.name, label: b.name }))] }],
    request: (ctx, a, v) => ({ action: "upstream", params: v.set ? { name: a.branch.name, set: v.set } : { name: a.branch.name, unset: true }, label: v.set ? a.branch.name + " follows " + v.set : "Remove the upstream of " + a.branch.name, verb: "Apply" }),
  },
  "merge-in": {
    label: (ctx, a) => "Merge " + (a && a.name ? a.name : "…") + " into " + (branchOf(ctx) || "this branch"),
    reason: (ctx, a) => rewriting(ctx) || (a.name === branchOf(ctx) ? "this is the branch you are on" : ""),
    form: () => [{ name: "mode", label: "How", type: "select", value: "", options: [{ value: "", label: "Fast-forward when possible, else a merge commit" }, { value: "no-ff", label: "Always a merge commit" }, { value: "ff-only", label: "Only fast-forward" }] }],
    request: (ctx, a, v) => ({ action: "merge-in", params: { name: a.name, ...(v.mode ? { mode: v.mode } : {}) }, label: "Merge " + a.name + " into " + branchOf(ctx), verb: "Merge" }),
  },
  "rebase-on": {
    label: (ctx, a) => "Rebase " + (branchOf(ctx) || "this branch") + " onto " + (a && a.name ? a.name : "…"),
    reason: (ctx, a) => rewriting(ctx) || (a.name === branchOf(ctx) ? "this is the branch you are on" : ""),
    request: (ctx, a) => ({ action: "rebase-on", params: { name: a.name }, label: "Rebase " + branchOf(ctx) + " onto " + a.name, verb: "Rebase" }),
  },
  "compare": { label: "Compare", special: "compare", reason: () => "" },
  "cherry-pick": {
    label: ctx => "Cherry-pick onto " + (branchOf(ctx) || "…"),
    reason: (ctx, a) => first(busy, onBranch, unprotected)(ctx) || (a.commit.parents.length > 1 ? "a merge commit: pick the commits it brought" : a.commit.sha === ctx.headSha ? "this is where you are" : "") || cleanTree(ctx),
    request: (ctx, a) => ({ action: "cherry-pick", params: { commits: [a.commit.sha] }, label: "Cherry-pick " + short(a.commit.sha), verb: "Cherry-pick" }),
  },
  "revert": { label: "Revert commit",
    reason: (ctx, a) => rewriting(ctx) || (a.commit.parents.length > 1 ? "a merge commit: revert the commits it brought" : ""),
    request: (ctx, a) => ({ action: "revert", params: { commit: a.commit.sha }, label: "Revert " + short(a.commit.sha), verb: "Revert" }),
  },
  "amend": { label: "Edit the message of the last commit",
    reason: (ctx, a) => rewriting(ctx) || (a.commit.sha !== ctx.headSha ? "only the last commit of the branch" : history(ctx, a.commit.sha)),
    form: (ctx, a) => [{ name: "message", label: "Message", type: "textarea", mono: true, required: true, value: a.commit.subject, load: "message", autofocus: true, hint: "Only the message changes: what is staged is not added." }],
    request: (ctx, a, v) => ({ action: "amend", params: { message: v.message.trim() }, label: "Edit the message of " + short(a.commit.sha), verb: "Change the message" }),
  },
  "tag": { label: "Create tag",
    reason: busy,
    form: (ctx, a) => [
      { name: "name", label: "Tag", type: "text", mono: true, required: true, branchName: true, placeholder: "v1.2.0", autofocus: true, hint: "At " + short(a.commit.sha) + " " + a.commit.subject },
      { name: "message", label: "Message (makes it an annotated tag)", type: "text" },
      { name: "push", label: "Push the tag to the remote", type: "checkbox" },
    ],
    request: (ctx, a, v) => ({ action: "tag", params: { name: v.name.trim(), commit: a.commit.sha, ...(v.message.trim() ? { message: v.message.trim() } : {}), push: !!v.push }, label: "Tag " + v.name.trim(), verb: "Create tag" }),
  },
  "untag": { label: "Delete tag",
    reason: busy,
    form: () => [{ name: "remote", label: "Delete it on the remote too", type: "checkbox" }],
    request: (ctx, a, v) => ({ action: "untag", params: { name: a.tag, remote: !!v.remote }, label: "Delete tag " + a.tag, verb: "Delete tag", tone: "destructive" }),
  },
  "reset": { label: "Reset the branch to a commit",
    reason: (ctx, a) => {
      const blocked = rewriting(ctx);
      if (blocked) return blocked;
      if (a.commit.sha === ctx.headSha) return "the branch is already here";
      const line = lineFrom(ctx, a.commit.sha);       // what the reset would drop: the commits after this one
      const onRemote = line && line.slice(1).find(c => ctx.pushed && ctx.pushed.has(c.sha));
      return onRemote ? short(onRemote.sha) + " is on a remote: a reset would drop it" : "";
    },
    form: (ctx, a) => [
      { name: "mode", label: "Mode", type: "select", value: "mixed", options: [
        { value: "soft", label: "Soft: keep the changes staged" }, { value: "mixed", label: "Mixed: keep the changes, not staged" }, { value: "hard", label: "Hard: lose the changes" }] },
      { name: "confirm_branch", label: "Type " + branchOf(ctx) + " to confirm", type: "typed", expect: branchOf(ctx), when: { mode: "hard" }, mono: true, hint: "A hard reset loses the changes of the commits it drops." },
    ],
    request: (ctx, a, v) => ({ action: "reset", params: { mode: v.mode, commit: a.commit.sha, ...(v.mode === "hard" ? { confirm_branch: v.confirm_branch } : {}) }, label: "Reset " + branchOf(ctx) + " to " + short(a.commit.sha) + " (" + v.mode + ")", verb: "Reset", tone: v.mode === "hard" ? "destructive" : "default" }),
  },
  "switch-detach": { label: "Check out the commit (detached)",
    reason: (ctx, a) => busy(ctx) || (a.commit.sha === ctx.headSha && !branchOf(ctx) ? "you are here" : ""),
    request: (ctx, a) => ({ action: "switch-detach", params: { commit: a.commit.sha }, label: "Check out " + short(a.commit.sha), verb: "Check out" }),
  },
  "drop": { label: "Drop commit",
    reason: (ctx, a) => rewriting(ctx) || (a.commit.parents.length > 1 ? "a merge commit cannot be dropped" : history(ctx, a.commit.sha)),
    request: (ctx, a) => ({ action: "drop", params: { commit: a.commit.sha }, label: "Drop " + short(a.commit.sha), verb: "Drop", tone: "destructive" }),
  },
  "move": { label: "Move commit up or down",
    reason: (ctx, a) => rewriting(ctx) || (a.commit.parents.length > 1 ? "a merge commit cannot be moved" : a.way === "up" && a.commit.sha === ctx.headSha ? "it is already the newest" : history(ctx, a.way === "down" ? (a.commit.parents[0] || a.commit.sha) : a.commit.sha)),
    request: (ctx, a) => ({ action: "move", params: { commit: a.commit.sha, way: a.way }, label: "Move " + short(a.commit.sha) + " " + a.way, verb: "Move" }),
  },
  "rewrite": { label: "Interactive rebase", special: "rewrite", reason: (ctx, a) => rewriting(ctx) || history(ctx, a.commit.sha) },
  "patch-create": { label: "Create a patch", special: "patch", reason: (ctx, a) => (a.commit.parents.length > 1 ? "a merge commit has no single patch" : "") },
  "patch-apply": { label: "Apply a patch",
    reason: rewriting,
    form: () => [{ name: "path", label: "Patch file", type: "text", mono: true, required: true, absolute: true, placeholder: "/home/you/fix.patch", autofocus: true, hint: "The path on this machine. Up to 5 MB." }],
    request: (ctx, a, v) => ({ action: "patch-apply", params: { path: v.path.trim() }, label: "Apply the patch", verb: "Apply" }),
  },
  "link": { label: "Copy the link of a commit", special: "link", reason: () => "" },
  "stage": { label: "Stage", special: "files", reason: busy },
  "unstage": { label: "Unstage", special: "files", reason: busy },
  "discard": { label: "Discard changes", special: "files", reason: busy },
  "stash": { label: "Stash changes",
    reason: first(busy, ctx => (anyChange(ctx) ? "" : "there is nothing to stash")),
    form: ctx => [
      { name: "message", label: "Message", type: "text", placeholder: "git-shuttle: changes of '" + branchOf(ctx) + "'", autofocus: true },
      { name: "untracked", label: "Include new files", type: "checkbox", value: num(ctx.status && ctx.status.untracked) > 0 },
    ],
    request: (ctx, a, v) => ({ action: "stash", params: { sub: "push", ...(v.message.trim() ? { message: v.message.trim() } : {}), untracked: !!v.untracked }, label: "Stash the changes", verb: "Stash" }),
  },
  "stash-pop": { label: "Pop the newest stash",
    reason: first(busy, ctx => (num(ctx.status && ctx.status.stash) > 0 ? "" : "the stash is empty"), cleanTree),
    request: () => ({ action: "stash", params: { sub: "pop", index: 0 }, label: "Pop the newest stash", verb: "Pop" }),
  },
  "stash-list": { label: "Stashes", special: "stashes", reason: () => "" },
  "addons": { label: "Add-ons", special: "addons", reason: () => "" },
  "addon-enable": { label: "Enable an add-on", special: "addons", reason: () => "" },
  "addon-disable": { label: "Disable an add-on", special: "addons", reason: () => "" },
  "addon-report": { label: "Turn the Customer report of an add-on on or off", special: "addons", reason: () => "" },
  "task-report": { label: "Add the pull request and commits to the Customer report", special: "tasks", reason: () => "" },
  "task-unbind": { label: "Unlink a branch from its task", special: "tasks", reason: () => "" },
  "task-bind": { label: "Link a branch to a task", special: "tasks", reason: () => "" },
  "addon-install": { label: "Install an add-on", special: "addons", reason: () => "" },
  "addon-uninstall": { label: "Remove an installed add-on", special: "addons", reason: () => "" },
  "tasks": { label: "Tasks", special: "tasks", reason: () => "" },
  "worktree-add": { label: "Add a worktree", special: "worktrees", reason: busy },
  "worktree-list": { label: "Worktrees", special: "worktrees", reason: () => "" },
  "ship": { label: "Ship", special: "tab", reason: () => "" },
  "release": { label: "Release", special: "tab", reason: () => "" },
  "pr": { label: "Open a pull request", special: "tab", reason: () => "" },
  "deploy": { label: "Deploy to a server", special: "tab", reason: () => "" },
  "deploy-check": { label: "Test the connection to a server", special: "tab", reason: () => "" },
  "deploy-setup": { label: "Set up a deploy target", special: "tab", reason: () => "" },
  "deploy-forget": { label: "Remove a deploy target", special: "tab", reason: () => "" },
  "continue": { label: "Continue", reason: ctx => (ctx.status && ctx.status.operation ? (ctx.busy ? "another action is running" : "") : "nothing is waiting"), request: () => ({ action: "continue", params: {}, label: "Continue", verb: "Continue", direct: true }) },
  "abort": { label: "Abort", reason: ctx => (ctx.status && ctx.status.operation ? (ctx.busy ? "another action is running" : "") : "nothing is waiting"), request: () => ({ action: "abort", params: {}, label: "Abort", verb: "Abort", tone: "destructive", direct: true }) },
  "resolve": { label: "Keep one side of a conflict", special: "conflict", reason: ctx => (ctx.status && ctx.status.operation ? "" : "nothing is waiting") },
  "undo": {
    label: ctx => "Undo" + (ctx.status && ctx.status["journal.undo"] ? " " + ctx.status["journal.undo"] : ""),
    reason: first(busy, ctx => (ctx.status && ctx.status["journal.undo"] ? "" : "nothing to undo")),
    request: ctx => ({ action: "undo", params: {}, label: "Undo " + ctx.status["journal.undo"], verb: "Undo" }),
  },
  "redo": {
    label: ctx => "Redo" + (ctx.status && ctx.status["journal.redo"] ? " " + ctx.status["journal.redo"] : ""),
    reason: first(busy, ctx => (ctx.status && ctx.status["journal.redo"] ? "" : "nothing to redo")),
    request: ctx => ({ action: "redo", params: {}, label: "Redo " + ctx.status["journal.redo"], verb: "Redo" }),
  },
  "journal": { label: "What was changed here", special: "journal", reason: () => "" },
  "log": { label: "Command log", special: "log", reason: () => "" },
  "settings": { label: "Settings", special: "settings", reason: () => "" },
  "add-repo": { label: "Add a repository", special: "add", reason: () => "" },
  "shortcuts": { label: "Keyboard shortcuts", special: "shortcuts", reason: () => "" },
  "about": { label: "About git-shuttle", special: "about", reason: () => "" },
  "update": { label: "Check for updates", special: "about", reason: () => "" },
};

// Actions that are about a commit or a branch: the palette points at the list, where their menu has them.
export const NEEDS_TARGET = new Set(["update-branch", "rename", "delete", "delete-remote", "upstream", "merge-in", "rebase-on", "compare", "cherry-pick", "revert", "amend", "tag", "untag", "reset", "switch-detach", "drop", "move", "rewrite", "patch-create", "link", "switch"]);

// The label of an action in a context (the catalog of the server has the default).
export const labelOf = (id, ctx, args, fallback) => { const op = OPS[id]; const l = op && op.label; return (typeof l === "function" ? l(ctx, args) : l) || fallback || id; };
export const reasonOf = (id, ctx, args) => { const op = OPS[id]; if (!op) return "unknown action"; try { return op.reason ? op.reason(ctx, args || {}) : ""; } catch (e) { return ""; } };

// ---- menus: which actions a place offers, in order ("-" is a separator)
export function commitMenuIds(commit, refs) {
  const tags = refs.filter(r => r.kind === "tag");
  return ["cherry-pick", "revert", "-", "branch", "tag", ...tags.map(t => ({ id: "untag", args: { tag: t.name }, label: "Delete tag " + t.name })), "-",
    "reset", "switch-detach", "-", "amend", "drop", { id: "move", args: { way: "up" }, label: "Move up" }, { id: "move", args: { way: "down" }, label: "Move down" }, "rewrite", "-",
    "compare", "patch-create", "link"];
}
export function branchMenuIds(branch, ctx) {
  const local = branch.ref.startsWith("refs/heads/");
  if (!local) return [{ id: "switch", args: { name: branch.name.replace(/^[^/]+\//, "") }, label: "Check out a local copy" }, "-", { id: "compare", args: { a: branch.name } }, { id: "delete-remote", args: { name: branch.name.replace(/^[^/]+\//, "") } }];
  return [
    ...(branch.current ? ["pull", "pull-rebase", "pull-merge", "sync", "sync-merge", "-"] : [{ id: "switch", args: { name: branch.name } }, { id: "update-branch", args: { branch } }, "-"]),
    { id: "rename", args: { branch } }, { id: "upstream", args: { branch } },
    ...(branch.current ? [] : [{ id: "merge-in", args: { name: branch.name } }, { id: "rebase-on", args: { name: branch.name } }]),
    { id: "compare", args: { a: branch.name } }, { id: "worktree-add", args: { branch } }, "-", { id: "delete", args: { branch } },
  ];
}
export function menuItems(ctx, entries, baseArgs = {}) {
  return entries.map(e => {
    if (e === "-") return "-";
    const spec = typeof e === "string" ? { id: e } : e;
    const args = { ...baseArgs, ...(spec.args || {}) };
    return { id: spec.id, args, label: spec.label || labelOf(spec.id, ctx, args, spec.id), reason: reasonOf(spec.id, ctx, args) };
  });
}

// ---- the palette: every action of the catalog matching what was typed (all the words, anywhere in the label, group or command line)
export function filterActions(entries, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored = entries.map((e, index) => {
    const hay = (e.label + " " + e.group + " " + (e.cli || "") + " " + (e.key || "")).toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
    const label = e.label.toLowerCase();
    return { e, index, score: words.reduce((s, w) => s + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0) + (e.reason ? -5 : 0) };
  }).filter(Boolean);
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(x => x.e);
}

// ---- what the one Sync button does now
export function syncPlan(ctx) {
  const s = ctx.status;
  if (!s) return { id: "fetch", label: "Fetch" };
  if (s.operation) return { id: "continue", label: "Continue" };
  if (!s.branch) return { id: "fetch", label: "Fetch" };
  const ahead = num(s["upstream.ahead"]), behind = num(s["upstream.behind"]);
  if (!s.upstream) return { id: "push", label: "Publish" };
  if (behind > 0 && ahead > 0) return { id: "pull-rebase", label: "Rebase on " + s.upstream };
  if (behind > 0) return { id: "pull", label: "Pull ↓" + behind };
  if (ahead > 0) return { id: "push", label: "Push ↑" + ahead };
  if (num(s["integration.behind"]) > 0 && s.protected !== "1") return { id: "sync", label: "Update from " + s["integration.ref"] };
  return { id: "fetch", label: "Fetch" };
}

// ---- keyboard shortcuts (not while typing in a field, unless the key has a modifier)
export const SHORTCUTS = [
  { keys: "Ctrl+K", id: "palette", text: "Open the actions palette" },
  { keys: "Ctrl+F", id: "search", text: "Search the commits" },
  { keys: "?", id: "shortcuts", text: "Show this list" },
  { keys: "Shift+F", id: "fetch", text: "Fetch" },
  { keys: "Shift+P", id: "push", text: "Push or publish" },
  { keys: "B", id: "branch", text: "New branch" },
  { keys: "S", id: "stash", text: "Stash the changes" },
  { keys: "Shift+S", id: "stash-pop", text: "Pop the newest stash" },
  { keys: "L", id: "log", text: "Command log" },
  { keys: "Ctrl+Z", id: "undo", text: "Undo the last change git-shuttle made" },
  { keys: "Ctrl+Shift+Z", id: "redo", text: "Redo" },
  { keys: "Esc", id: "", text: "Close a dialog or menu" },
  { keys: "↑ ↓", id: "", text: "Move through the commits and the files" },
  { keys: "Enter", id: "", text: "Open the selected row" },
  { keys: "Shift+F10", id: "", text: "Menu of the selected row" },
  { keys: "Alt+← →", id: "", text: "Move a focused column header" },
];
export function shortcutFor(e) {
  const tag = (e.target && e.target.tagName) || "";
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey) return "";
  if (mod && key === "k") return "palette";
  if (mod && key === "f") return "search";
  if (typing) return "";
  if (mod && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod) return "";
  if (e.key === "?") return "shortcuts";
  if (e.shiftKey && key === "f") return "fetch";
  if (e.shiftKey && key === "p") return "push";
  if (e.shiftKey && key === "s") return "stash-pop";
  if (e.shiftKey) return "";
  return { b: "branch", s: "stash", l: "log" }[key] || "";
}
