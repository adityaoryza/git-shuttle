#!/usr/bin/env python3
"""The trace of the tasks: what happened to each task, from its first commit to the deploy that carried it (git-shuttle, docs/addons.md).

A branch that was started from a task remembers the task (branch.NAME.shuttle-ref-*). Every step that git-shuttle takes on that branch adds one
line to  <git dir>/shuttle-trace/events.jsonl : start, commit, push, pr, merge, release. A deploy is written without a task; here, when a task is
looked at, the deploys that carried its merge (the merge commit is an ancestor of what was deployed) are added.

    trace.py append FILE key=value ...        add an event (the time is added; d.LABEL=value goes to "details")
    trace.py tasks FILE                       one JSON object: the tasks that have events, with the first and the last
    trace.py show FILE ADDON ID [--repo DIR]  one JSON object: the task and its events in order, deploys included

The file is private (0600) and is cut to its newest 20000 lines. Standard library only; run with -I.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
DETAIL_RE = re.compile(r"^d\.[^=\x00-\x1f]{1,40}$")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
MAX_VALUE = 2000
MAX_LINES = 20000
MAX_BRANCH_COMMITS = 150
SHA_RE = re.compile(r"^[0-9a-f]{7,64}$")


def clean(value):
    return CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))[:MAX_VALUE]


def utc(text):
    """An ISO date, with or without an offset (git: +02:00, gh: Z), as UTC with a Z."""
    when = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append(path, pairs, once=False):
    """at=DATE puts the event at that date (a commit that was made last week). once: nothing is added when the same step is already there."""
    event = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    details = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep:
            raise ValueError("%r is not key=value" % pair)
        if key == "at":
            event["time"] = utc(value)
        elif DETAIL_RE.match(key):
            details[key[2:]] = clean(value)
        elif KEY_RE.match(key) and key != "time":
            event[key] = clean(value)
        else:
            raise ValueError("%r is not a key of an event" % key)
    if details:
        event["details"] = details
    if not event.get("type"):
        raise ValueError("an event needs a type")
    if once and any(all(e.get(k) == event.get(k) for k in ("type", "addon", "task", "sha", "url")) for e in events(path)):
        return
    folder = os.path.dirname(path)
    os.makedirs(folder, mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    trim(path)


def trim(path):
    try:
        if os.path.getsize(path) < MAX_LINES * 120:
            return
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
        if len(lines) > MAX_LINES:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as out:
                out.writelines(lines[-MAX_LINES:])
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
    except OSError:
        pass


def events(path):
    out = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict) and event.get("type") and event.get("time"):
                    out.append(event)
    except OSError:
        pass
    return out


def tasks(path):
    seen = {}
    for event in events(path):
        if not event.get("task"):
            continue
        key = (event.get("addon", ""), event["task"])
        item = seen.setdefault(key, {"addon": key[0], "id": key[1], "title": "", "link": "", "first": event["time"], "branches": [], "events": 0})
        item["events"] += 1
        item["last"], item["last_type"] = event["time"], event["type"]
        if event.get("title"):
            item["title"] = event["title"]
        if event.get("link"):
            item["link"] = event["link"]
        if event.get("branch") and event["branch"] not in item["branches"]:
            item["branches"].append(event["branch"])
    return {"tasks": sorted(seen.values(), key=lambda t: t["last"], reverse=True)}


def is_ancestor(repo, older, newer):
    if not (SHA_RE.match(older or "") and SHA_RE.match(newer or "")):
        return False
    try:
        done = subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=repo, capture_output=True, timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0


def show(path, addon, task_id, repo=None):
    mine = [e for e in events(path) if e.get("task") == task_id and e.get("addon", "") == addon]
    merges = [e["sha"] for e in mine if e["type"] == "merge" and e.get("sha")]
    derived = []
    if repo and merges:
        for event in events(path):
            if event["type"] == "deploy" and not event.get("task") and any(is_ancestor(repo, m, event.get("tip", "")) for m in merges):
                derived.append(dict(event, derived="the merge of this task is in what was deployed"))
    rows = sorted(mine + derived, key=lambda e: e["time"])
    head = {"addon": addon, "id": task_id, "title": "", "link": "", "branches": []}
    for event in mine:
        head["title"] = event.get("title") or head["title"]
        head["link"] = event.get("link") or head["link"]
        if event.get("branch") and event["branch"] not in head["branches"]:
            head["branches"].append(event["branch"])
    return {"task": head, "events": rows}


def commits_of(repo, base, branch):
    """The commits of the branch that the integration branch does not have, oldest first: [(sha, date, subject)]."""
    try:
        done = subprocess.run(["git", "log", "--reverse", "--max-count=300", "--format=%H%x1f%aI%x1f%s", "%s..%s" % (base, branch)], cwd=repo,
                              capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return []
    rows = [line.split("\x1f") for line in done.stdout.decode("utf-8", "replace").splitlines()]
    return [(r[0], r[1], r[2]) for r in rows if len(r) == 3 and SHA_RE.match(r[0])]


def git_lines(repo, *args):
    try:
        done = subprocess.run(["git", *args], cwd=repo, capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return []
    return done.stdout.decode("utf-8", "replace").splitlines() if done.returncode == 0 else []


def merged_commits(repo, base, branch):
    """A branch that has no commit of its own because it was merged: the commits that its merge brought in, and the merge: ([(sha, date, subject)],
    (merge sha, date)), or None. The branch points at the merge itself, or it is part of the history of the base and a merge of it is found there."""
    merge = ""
    parents = (git_lines(repo, "rev-list", "--parents", "-n", "1", branch) or [""])[0].split()
    if len(parents) == 3:
        merge = parents[0]
    elif is_ancestor(repo, branch, base):
        path = git_lines(repo, "log", "--first-parent", "--merges", "--ancestry-path", "--reverse", "--max-count=1", "--format=%H", "%s..%s" % (branch, base))
        merge = path[0] if path else ""
    if not SHA_RE.match(merge):
        return None
    parents = (git_lines(repo, "rev-list", "--parents", "-n", "1", merge) or [""])[0].split()
    if len(parents) != 3:
        return None
    found = commits_of(repo, parents[1], parents[2])
    if not found or len(found) > MAX_BRANCH_COMMITS:
        return None
    date = (git_lines(repo, "log", "-n", "1", "--format=%cI", merge) or [""])[0]
    return found, (merge, date)


def backfill(path, who, repo, base, pr_file):
    """A branch that already had commits is linked to a task: what it already did is written with its own dates (start, commits, the pull
    request and its merge). who: addon, task, title, link, branch. Run again, it adds only what is not yet there."""
    pr = {}
    if pr_file:
        try:
            with open(pr_file, encoding="utf-8") as handle:
                pr = json.load(handle)
        except (OSError, ValueError):
            pr = {}
    if not isinstance(pr, dict):
        pr = {}
    commits = commits_of(repo, base, who["branch"])
    merged = None
    if not commits:         # the branch was merged (it points at the merge, or is in the history of the base): its work is what that merge brought
        found = merged_commits(repo, base, who["branch"])
        if found:
            commits, merged = found
    known = {sha for sha, _, _ in commits}
    for item in pr.get("commits") or []:
        try:
            if item["oid"] not in known and SHA_RE.match(item["oid"]):
                commits.append((item["oid"], item["committedDate"], item.get("messageHeadline") or ""))
                known.add(item["oid"])
        except (KeyError, TypeError):
            continue
    commits.sort(key=lambda c: utc(c[1]))
    common = ["addon=" + who["addon"], "task=" + who["task"], "title=" + who["title"], "link=" + who["link"], "branch=" + who["branch"], "linked=later"]
    added = 0

    def add(*pairs):
        nonlocal added
        append(path, ["type=" + pairs[0]] + list(common) + list(pairs[1:]), once=True)
        added += 1
    if commits and not any(e["type"] == "start" and e.get("task") == who["task"] and e.get("addon") == who["addon"] for e in events(path)):
        add("start", "at=" + commits[0][1], "sha=" + commits[0][0], "from=" + base)
    for sha, date, subject in commits:
        add("commit", "at=" + date, "sha=" + sha, "subject=" + subject)
    if pr.get("url"):
        add("pr", "at=" + (pr.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())), "url=" + pr["url"], "title=" + (pr.get("title") or ""),
            "base=" + (pr.get("baseRefName") or ""))
        merged = (pr.get("mergeCommit") or {}).get("oid", "")
        if pr.get("state") == "MERGED" and pr.get("mergedAt") and SHA_RE.match(merged):
            add("merge", "at=" + pr["mergedAt"], "sha=" + merged, "into=" + (pr.get("baseRefName") or ""), "url=" + pr["url"])
    if merged and not (pr.get("state") == "MERGED" and pr.get("mergeCommit")) and merged[1]:
        add("merge", "at=" + merged[1], "sha=" + merged[0], "into=" + base.split("/", 1)[-1])
    return {"events": added, "commits": len(commits), "pr": bool(pr.get("url")), "merged": pr.get("state") == "MERGED"}


def mapping(path, repo, base):
    """Which commits and branches are for which task, to mark them in the graph: {commits: {sha: [addon, id]}, branches: {name: {addon, id, title}}}.
    A commit is for the task when the trace recorded it, or when it is on a branch for the task and not in the integration branch."""
    out = {"commits": {}, "branches": {}, "tasks": {}}
    for event in events(path):
        if event.get("task"):
            known = out["tasks"].setdefault(event.get("addon", "") + ":" + event["task"], {"title": "", "link": ""})
            known["title"] = event.get("title") or known["title"]
            known["link"] = event.get("link") or known["link"]
        if event.get("task") and event["type"] in ("commit", "merge") and SHA_RE.match(event.get("sha") or ""):
            out["commits"][event["sha"]] = [event.get("addon", ""), event["task"]]
    try:
        done = subprocess.run(["git", "config", "--get-regexp", r"^branch\..+\.shuttle-ref-(addon|id|title|link)$"], cwd=repo, capture_output=True,
                              timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return out
    for line in done.stdout.decode("utf-8", "replace").splitlines():
        key, _, value = line.partition(" ")
        match = re.match(r"^branch\.(.+)\.shuttle-ref-(addon|id|title|link)$", key)
        if match:
            out["branches"].setdefault(match.group(1), {"addon": "", "id": "", "title": "", "link": ""})[match.group(2)] = value
    out["branches"] = {name: b for name, b in out["branches"].items() if b["id"]}
    for b in out["branches"].values():
        known = out["tasks"].setdefault(b["addon"] + ":" + b["id"], {"title": "", "link": ""})
        known["title"] = b["title"] or known["title"]
        known["link"] = b["link"] or known["link"]
    shared = set(os.environ.get("TRACE_SHARED", "").split())
    for name, b in out["branches"].items():
        found = commits_of(repo, base, name) if name not in shared else []
        if len(found) > MAX_BRANCH_COMMITS:      # not the work of one task (a branch that was linked by mistake): its commits are not marked
            continue
        for sha, _, _ in found:
            out["commits"].setdefault(sha, [b["addon"], b["id"]])
    return out


def forget(path, branch):
    """Takes the events of a branch out of the trace (it was linked to a task by mistake). Returns how many were taken out."""
    kept, gone = [], 0
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return 0
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            kept.append(line)
            continue
        if isinstance(event, dict) and event.get("branch") == branch and event.get("task"):
            gone += 1
        else:
            kept.append(line)
    if gone:
        tmp = path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.writelines(kept)
        os.replace(tmp, path)
    return gone


def main(argv):
    try:
        if len(argv) >= 4 and argv[1] in ("append", "append-once"):
            append(argv[2], argv[3:], once=argv[1] == "append-once")
        elif len(argv) == 5 and argv[1] == "backfill":
            # backfill FILE JSON(who) REPO BASE [PRFILE]: who is read from the JSON in argv[3]; the pull request, from a file of gh
            print(json.dumps(backfill(argv[2], json.loads(argv[3]), argv[4], os.environ.get("TRACE_BASE", "HEAD"), os.environ.get("TRACE_PR") or None)))
        elif len(argv) == 4 and argv[1] == "forget":
            print(forget(argv[2], argv[3]))
        elif len(argv) == 4 and argv[1] == "map":
            print(json.dumps(mapping(argv[2], argv[3], os.environ.get("TRACE_BASE", "HEAD")), ensure_ascii=False))
        elif len(argv) == 3 and argv[1] == "tasks":
            print(json.dumps(tasks(argv[2]), ensure_ascii=False))
        elif len(argv) >= 5 and argv[1] == "show":
            repo = argv[argv.index("--repo") + 1] if "--repo" in argv else None
            print(json.dumps(show(argv[2], argv[3], argv[4], repo), ensure_ascii=False))
        else:
            sys.stderr.write("usage: trace.py append FILE key=value... | tasks FILE | show FILE ADDON ID [--repo DIR]\n")
            return 2
    except (ValueError, IndexError) as error:
        sys.stderr.write("%s\n" % error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
