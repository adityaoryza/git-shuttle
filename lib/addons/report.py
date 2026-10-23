#!/usr/bin/env python3
"""The input of the `report` hook (git-shuttle, docs/addons.md): the pull request and the commits of a branch that is for a task.

    report.py input ACTION REPO BRANCH BASE NAME REF_ID [PRFILE]     one JSON object on standard output

ACTION is preview or post. PRFILE is what `gh pr view --json url,title,baseRefName` said (or {"title", "baseRefName"} when the pull request is
not opened yet). The address of the repository on the web is made from the remote, WITHOUT what comes before the @ (a token): the add-on gets
only the address of the repository on the web (host and owner/repo). Standard library only; run with -I.
"""
import json
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
    rows = git(repo, "log", "--reverse", "--max-count=%d" % MAX_COMMITS, "--format=%H%x1f%s", "origin/%s..%s" % (base, branch))
    if not rows:
        rows = git(repo, "log", "--reverse", "--max-count=%d" % MAX_COMMITS, "--format=%H%x1f%s", "%s..%s" % (base, branch))
    commits = []
    for row in rows:
        sha, _, subject = row.partition("\x1f")
        if SHA_RE.match(sha):
            commits.append({"sha": sha, "subject": subject[:200], "url": "%s/commit/%s" % (web, sha) if web else ""})
    link = pr.get("url") if isinstance(pr.get("url"), str) and re.match(r"^https?://[^\s<>\"'`]{1,500}$", pr.get("url", "")) else ""
    return {"protocol": 1, "hook": "report", "action": action, "repo": {"root": repo, "name": name, "web": web}, "branch": branch, "ref_id": ref_id,
            "pr": {"url": link, "title": str(pr.get("title") or "")[:200], "base": str(pr.get("baseRefName") or base)[:120]}, "commits": commits}


def main(argv):
    if len(argv) in (8, 9) and argv[1] == "input" and argv[2] in ("preview", "post"):
        print(json.dumps(build(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7], argv[8] if len(argv) == 9 else ""), ensure_ascii=False))
        return 0
    sys.stderr.write("usage: report.py input preview|post REPO BRANCH BASE NAME REF_ID [PRFILE]\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
