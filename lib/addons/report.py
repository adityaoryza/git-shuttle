#!/usr/bin/env python3
"""The input of the `report` hook (git-shuttle, docs/addons.md): the pull request and the commits of a branch that is for a task.

    report.py input ACTION REPO BRANCH BASE NAME REF_ID [PRFILE]     one JSON object on standard output

ACTION is preview or post. PRFILE is what `gh pr view --json url,title,baseRefName` said (or {"title", "baseRefName"} when the pull request is
not opened yet). The address of the repository on the web is made from the remote, WITHOUT what comes before the @ (a token): the add-on gets
only the address of the repository on the web (host and owner/repo). Standard library only; run with -I.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

SHA_RE = re.compile(r"^[0-9a-f]{7,64}$")
REMOTE_RE = re.compile(r"^(?:git@|ssh://git@|https?://(?:[^@/]+@)?)([A-Za-z0-9.-]+)[:/](?:\d+/)?([\w.-]+/[\w./-]+?)(?:\.git)?/?$")
MAX_COMMITS = 100


def git(repo, *args):
    try:
        done = subprocess.run(["git", *args], cwd=repo, capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return []
    return done.stdout.decode("utf-8", "replace").splitlines() if done.returncode == 0 else []


def web_url(remote):
    found = REMOTE_RE.match((remote or "").strip())
    return "%s://%s/%s" % ("https", found.group(1), found.group(2)) if found else ""


def trace_module():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("shuttle_trace_for_report", os.path.join(here, "trace.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def is_ancestor(repo, sha, ref):
    try:
        return subprocess.run(["git", "merge-base", "--is-ancestor", sha, ref], cwd=repo, capture_output=True, timeout=10, stdin=subprocess.DEVNULL).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def phases_of(trace_file, addon, task, repo, web, pr_commits, branch):
    """The steps of the task, in order, from its trace: started, linked, commits, pushed, pull request, merged, released, deployed.

    [{title, when, items: [{text, url, ref}]}]. `ref` is a text that stays visible in the report: the add-on leaves out an item whose ref is already there.
    """
    trace = trace_module()
    events = trace.show(trace_file, addon, task, repo)["events"]
    def link(path):
        return "%s/%s" % (web, path) if web else ""
    def when(event):
        return event["time"]
    out = []
    first = lambda kind: next((e for e in events if e["type"] == kind), None)
    start, binds = first("start"), [e for e in events if e["type"] == "bind"]
    if start:
        items = [{"text": "branch %s" % start.get("branch", ""), "ref": start.get("branch", "")}]
        items += [{"text": "%s: %s" % (k, v), "ref": "%s: %s" % (k, v)} for k, v in (start.get("details") or {}).items()]
        out.append({"title": "Started", "when": when(start), "items": items})
    for event in binds:
        if not start or event.get("branch") != start.get("branch"):
            out.append({"title": "Linked to the task", "when": when(event), "items": [{"text": "branch %s" % event.get("branch", ""), "ref": event.get("branch", "")}]})
            break
    seen, items = set(), []
    source = pr_commits or [(e.get("sha", ""), e.get("subject", "")) for e in events if e["type"] == "commit"]
    for sha, subject in source:
        # a commit that was rewritten (rebase, amend) is not in the branch any more: it is not the task's work as it stands
        if SHA_RE.match(sha or "") and sha not in seen and (pr_commits or is_ancestor(repo, sha, branch)):
            seen.add(sha)
            items.append({"text": "%s %s" % (sha[:8], (subject or "")[:200]), "url": link("commit/" + sha), "ref": sha[:8]})
    commit_events = [e for e in events if e["type"] == "commit"]
    if items:
        out.append({"title": "Commits", "when": when(commit_events[0]) if commit_events else when(events[0]), "items": items})
    pushes = [e for e in events if e["type"] == "push" and SHA_RE.match(e.get("sha", ""))]
    if pushes:
        last = pushes[-1]
        out.append({"title": "Pushed", "when": when(last), "items": [{"text": "%s · %s" % (last.get("branch", ""), last["sha"][:8]), "ref": "pushed %s" % last["sha"][:8]}]})
    prs = [e for e in events if e["type"] == "pr" and re.match(r"^https?://", e.get("url", ""))]
    for event in prs:
        out.append({"title": "Pull request", "when": when(event), "items": [{"text": "%s → %s" % (event.get("title", "") or "pull request", event.get("base", "")), "url": event["url"], "ref": event["url"]}]})
    for event in [e for e in events if e["type"] == "merge" and SHA_RE.match(e.get("sha", ""))]:
        out.append({"title": "Merged", "when": when(event), "items": [{"text": "merged into %s · %s" % (event.get("into", "") or "the integration branch", event["sha"][:8]), "url": link("commit/" + event["sha"]), "ref": event["sha"][:8]}]})
    for event in [e for e in events if e["type"] == "release" and e.get("release_branch")]:
        out.append({"title": "Released", "when": when(event), "items": [{"text": "in %s" % event["release_branch"], "url": link("tree/" + event["release_branch"]), "ref": event["release_branch"]}]})
    for event in [e for e in events if e["type"] == "deploy"][-5:]:
        text = "to %s (branch %s)" % (event.get("target", ""), event.get("branch", ""))
        out.append({"title": "Deployed", "when": when(event), "items": [{"text": text, "at": when(event)}]})
    return out


def build(action, repo, branch, base, name, ref_id, pr_file):
    pr = {}
    if pr_file:
        try:
            with open(pr_file, encoding="utf-8") as handle:
                pr = json.load(handle)
        except (OSError, ValueError):
            pr = {}
    if not isinstance(pr, dict):
        pr = {}
    web = web_url((git(repo, "remote", "get-url", "origin") or [""])[0])
    rows = git(repo, "log", "--reverse", "--no-merges", "--max-count=%d" % MAX_COMMITS, "--format=%H%x1f%s", "origin/%s..%s" % (base, branch))
    if not rows:
        rows = git(repo, "log", "--reverse", "--no-merges", "--max-count=%d" % MAX_COMMITS, "--format=%H%x1f%s", "%s..%s" % (base, branch))
    # the commits of the pull request itself, when there is one: what a branch holds besides (merges of staging, work of another task) is not the task's
    pairs = []
    for item in pr.get("commits") or []:
        if isinstance(item, dict) and isinstance(item.get("oid"), str) and SHA_RE.match(item["oid"]):
            pairs.append((item["oid"], str(item.get("messageHeadline") or "")))
    if not pairs:
        pairs = [(row.partition("\x1f")[0], row.partition("\x1f")[2]) for row in rows]
    commits = []
    for sha, subject in pairs[:MAX_COMMITS]:
        if SHA_RE.match(sha):
            commits.append({"sha": sha, "subject": subject[:200], "url": "%s/commit/%s" % (web, sha) if web else ""})
    link = pr.get("url") if isinstance(pr.get("url"), str) and re.match(r"^https?://[^\s<>\"'`]{1,500}$", pr.get("url", "")) else ""
    doc = {"protocol": 1, "hook": "report", "action": action, "repo": {"root": repo, "name": name, "web": web}, "branch": branch, "ref_id": ref_id,
           "pr": {"url": link, "title": str(pr.get("title") or "")[:200], "base": str(pr.get("baseRefName") or base)[:120]}, "commits": commits}
    # the steps of the task from its trace (git shuttle sets the two variables); without them the report is the pull request and its commits
    if os.environ.get("REPORT_TRACE_FILE") and os.environ.get("REPORT_ADDON"):
        try:
            phases = phases_of(os.environ["REPORT_TRACE_FILE"], os.environ["REPORT_ADDON"], ref_id, repo, web, pairs if pr.get("commits") else [], branch)
            if phases:       # a task that has no trace (linked by hand) keeps the report of the pull request and its commits
                doc["phases"] = phases
        except (OSError, ValueError, KeyError):
            pass
    return doc


def main(argv):
    if len(argv) in (8, 9) and argv[1] == "input" and argv[2] in ("preview", "post"):
        print(json.dumps(build(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7], argv[8] if len(argv) == 9 else ""), ensure_ascii=False))
        return 0
    sys.stderr.write("usage: report.py input preview|post REPO BRANCH BASE NAME REF_ID [PRFILE]\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
