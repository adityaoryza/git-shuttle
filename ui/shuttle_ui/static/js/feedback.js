/* The words of the feedback after an action: what a toast says. Pure, tested with node. */

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// "3 new commits, 2 branches updated, 1 pruned" or "Already up to date", from the summary the server gives for a fetch.
export function describeFetch(summary) {
  if (!summary) return "";
  if (summary.up_to_date) return "Already up to date";
  const parts = [];
  if (summary.new_commits) parts.push(plural(summary.new_commits, "new commit", "new commits"));
  const touched = (summary.created || []).length + (summary.updated || []).length;
  if (touched) parts.push(plural(touched, "branch", "branches") + " updated");
  if ((summary.pruned || []).length) parts.push((summary.pruned.length) + " pruned");
  return parts.join(", ");
}

export function fetchToast(result, remote) {
  if (result && result.ok) {
    return { variant: "success", title: "Fetched " + (result.remote || remote || "remote"), detail: describeFetch(result.summary) };
  }
  return {
    variant: "error", title: "Fetch failed",
    detail: firstProblem(result && result.output) || "The remote did not answer.",
    next: "Check the network and the remote address, then try again.",
  };
}

const URL_RE = /https?:\/\/\S+/;

// The most useful line of what a command printed when it went wrong.
export function firstProblem(output) {
  const lines = String(output || "").split("\n").map(l => l.trim()).filter(Boolean);
  // the last "error:" line is git-shuttle's own; the ones before it are git's
  const last = pattern => [...lines].reverse().find(l => pattern.test(l));
  const wanted = last(/^(error|fatal|stopped):/i) || last(/error|fatal|refused|cannot/i) || lines[lines.length - 1] || "";
  return wanted.replace(/^(error|fatal|stopped):\s*/i, "");
}

function hint(problem) {
  const p = problem.toLowerCase();
  if (p.includes("uncommitted") || p.includes("working tree") || p.includes("local changes")) return "Commit, stash or discard the changes, then try again.";
  if (p.includes("conflict")) return "Resolve the conflicts, then continue (or abort).";
  if (p.includes("protected")) return "Work on a feature branch instead.";
  if (p.includes("already exists")) return "Pick another name, or switch to the existing branch.";
  if (p.includes("rejected") || p.includes("non-fast-forward")) return "Fetch and rebase first; a force push has to be chosen explicitly.";
  if (p.includes("does not exist")) return "Fetch, then check the branch name.";
  return "Read the log for details, fix the cause, then try again.";
}

// job: what the server reports about a finished job; ctx: { branch, integration }.
export function describeJob(job, ctx = {}) {
  const steps = job.steps || [];
  const output = steps.map(s => s.output || "").join("\n");
  // the step that went wrong (the ones after it never ran), or the last one
  const last = steps.find(s => s.state === "stopped") || (steps.length ? steps[steps.length - 1] : { output: "" });
  const label = job.label || job.action;
  if (job.state === "stopped") {
    const problem = firstProblem(last.output) || "Something needs your attention.";
    return { variant: "warning", title: label + " stopped", detail: problem, next: hint(problem), log: true };
  }
  if (job.state !== "done") {
    const problem = firstProblem(last.output) || "The command failed.";
    return { variant: "error", title: label + " failed", detail: problem, next: hint(problem), log: true };
  }
  const quoted = re => { const m = re.exec(output); return m ? m[1] : ""; };
  const url = (URL_RE.exec(output) || [""])[0];
  switch (job.action) {
    case "start": return { variant: "success", title: "Branch created", detail: quoted(/on '([^']+)'/), next: "Make your changes, then use Ship." };
    case "branch": return { variant: "success", title: "Branch created", detail: quoted(/on '([^']+)'/) };
    case "switch": return { variant: "success", title: "Switched branch", detail: quoted(/on '([^']+)'/) || label };
    case "ship": {
      const into = quoted(/is in '([^']+)' on origin/);
      return url ? { variant: "success", title: "Pull request opened", detail: url, copy: url }
        : { variant: "success", title: into ? "Merged into " + into : "Shipped", detail: quoted(/done: '([^']+)'/) };
    }
    case "pr": return { variant: "success", title: "Pull request opened", detail: url, copy: url };
    case "push": {
      const verb = /^Publish/.test(label) ? "Published" : /^Force/.test(label) ? "Force pushed" : "Pushed";
      return { variant: "success", title: verb, detail: quoted(/git push (?:-u )?(?:--force-with-lease )?\S+ (\S+)/) };
    }
    case "release": return { variant: "success", title: "Release branch created", detail: quoted(/'([^']+)' is ready/) };
    case "stage": case "unstage": case "discard": {
      const verb = { stage: "Staged", unstage: "Unstaged", discard: "Discarded" }[job.action];
      return { variant: "success", title: verb, detail: label.replace(/^[A-Za-z]+ /, "") };
    }
    case "init": return { variant: "success", title: "Settings saved", detail: "" };
    case "cherry-pick": return { variant: "success", title: "Cherry-picked", detail: quoted(/now has (\d+ more commit)/) };
    case "continue": return { variant: "success", title: "Continued", detail: "" };
    case "abort": return { variant: "info", title: "Aborted", detail: "The repository is back to how it was." };
    case "pull": case "sync": case "merge-in": case "rebase-on": {
      if (/already up to date|nothing to (merge|rebase)/i.test(output)) return { variant: "info", title: "Already up to date", detail: "" };
      const n = /(\d+) (?:new )?commit/.exec(output);
      return { variant: "success", title: label, detail: (n ? n[1] + (n[1] === "1" ? " commit" : " commits") + " · " : "") + lastStep(output) };
    }
    case "undo": case "redo": return { variant: "success", title: label, detail: lastStep(output) };
    default: return { variant: "success", title: label + " done", detail: lastStep(output) };
  }
}

// The last line a command printed about what it did (its "step" line), without the command echoes.
export function lastStep(output) {
  const lines = String(output || "").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("$") && !l.startsWith("#"));
  return (lines[lines.length - 1] || "").replace(/^[✓✔→>\s]+/, "").slice(0, 160);
}

// What the toast host needs for a spec made by describeJob or fetchToast: the next step joins the detail, and the buttons
// are the ones that make sense (copy a link, show the log).
export function toToast(spec, { showLog } = {}) {
  const join = "\n";
  const actions = [];
  if (spec.copy) actions.push({ label: "Copy link", copy: spec.copy });
  if (spec.log && showLog) actions.push({ label: "Show log", onClick: showLog });
  return { variant: spec.variant, title: spec.title, detail: [spec.detail, spec.next].filter(Boolean).join(join), actions };
}
