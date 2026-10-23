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

KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
DETAIL_RE = re.compile(r"^d\.[^=\x00-\x1f]{1,40}$")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
MAX_VALUE = 2000
MAX_LINES = 20000
SHA_RE = re.compile(r"^[0-9a-f]{7,64}$")


def clean(value):
    return CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))[:MAX_VALUE]


def append(path, pairs):
    event = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    details = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep:
            raise ValueError("%r is not key=value" % pair)
        if DETAIL_RE.match(key):
            details[key[2:]] = clean(value)
        elif KEY_RE.match(key) and key != "time":
            event[key] = clean(value)
        else:
            raise ValueError("%r is not a key of an event" % key)
    if details:
        event["details"] = details
    if not event.get("type"):
        raise ValueError("an event needs a type")
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


def main(argv):
    try:
        if len(argv) >= 4 and argv[1] == "append":
            append(argv[2], argv[3:])
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
