"""The API routes: what each URL does. Nothing here knows about HTTP."""
import os
import subprocess

from .errors import BadRequest
from .graph import branch_list, commit_graph
from .runner import child_env, run_shuttle, shuttle_porcelain
from .validate import NAME_RE, build_commands, text


def repo_summary(repo):
    base = {"id": repo["id"], "name": repo["name"], "path": repo["path"]}
    try:
        base["status"] = shuttle_porcelain(repo["path"], "status")
    except (BadRequest, subprocess.SubprocessError, OSError) as error:
        base["error"] = str(error)
    return base


def register(store, path):
    if not isinstance(path, str) or not path or "\0" in path or not os.path.isabs(path):
        raise BadRequest("give the absolute path of a repository")
    real = os.path.realpath(path)
    if not os.path.isdir(real):
        raise BadRequest("that folder does not exist")
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
    if done.returncode != 0:
        raise BadRequest("that folder is not a git repository")
    return store.add_repo(os.path.realpath(done.stdout.decode("utf-8", "replace").strip()))


def fetch(repo):
    remote = subprocess.run(["git", "config", "--get", "shuttle.remote"], cwd=repo["path"], env=child_env(), capture_output=True)
    name = remote.stdout.decode().strip() or "origin"
    if not NAME_RE.match(name):
        raise BadRequest("shuttle.remote is not a valid remote name")
    done = subprocess.run(["git", "fetch", "--quiet", name], cwd=repo["path"], env=child_env(), capture_output=True, timeout=120)
    return {"ok": done.returncode == 0, "output": (done.stdout + done.stderr).decode("utf-8", "replace")}


def candidates(repo):
    raw = shuttle_porcelain(repo["path"], "candidates")
    merges, by_merge = [], {}
    for rec in raw["candidate"]:
        merge, date, subject = (rec.split("\x1f") + ["", ""])[:3]
        item = {"merge": merge, "date": date, "subject": subject, "commits": []}
        merges.append(item)
        by_merge[merge] = item
    for rec in raw["commit"]:
        merge, h, mark, subject = (rec.split("\x1f") + ["", "", ""])[:4]
        if merge in by_merge:
            by_merge[merge]["commits"].append({"hash": h, "pending": mark == "+", "subject": subject})
    return merges


def preview(repo, body):
    action = text(body.get("action"), "action", 50, True, True)
    commands = build_commands(action, body.get("params"))
    steps = []
    for i, argv in enumerate(commands):
        # the steps after a commit assume that the commits were made
        extra = {"GIT_SHUTTLE_ASSUME_COMMITTED": "1"} if any(c[0] in ("commit", "stage") for c in commands[:i]) else None
        code, output = run_shuttle(repo["path"], argv, dry_run=True, extra_env=extra)
        steps.append({"argv": argv, "exit": code, "output": output})
        if code != 0:
            break
    return {"steps": steps, "ok": all(s["exit"] == 0 for s in steps)}


def handle(server, method, route, body):
    store, jobs = server.store, server.jobs
    parts = [p for p in route.split("/") if p]
    if method == "GET" and parts == ["repos"]:
        return {"repos": [repo_summary(r) for r in store.repos()]}
    if method == "POST" and parts == ["repos"]:
        return {"repo": register(store, body.get("path"))}
    if method == "GET" and parts == ["history"]:
        return {"history": store.history()}
    if method == "GET" and len(parts) == 2 and parts[0] == "jobs":
        return {"job": jobs.get(parts[1])}
    if len(parts) >= 2 and parts[0] == "repos":
        repo = store.find(parts[1])
        rest = parts[2:]
        if method == "POST" and rest == ["remove"]:
            store.remove_repo(repo["id"])
            return {"ok": True}
        if method == "GET" and rest == ["status"]:
            return {"status": shuttle_porcelain(repo["path"], "status")}
        if rest == ["graph"] and method in ("GET", "POST"):
            return commit_graph(repo["path"], body.get("refs") if method == "POST" else None)
        if method == "GET" and rest == ["branches"]:
            return branch_list(repo["path"])
        if method == "GET" and rest == ["candidates"]:
            return {"candidates": candidates(repo)}
        if method == "POST" and rest == ["fetch"]:
            return fetch(repo)
        if method == "POST" and rest == ["preview"]:
            return preview(repo, body)
        if method == "POST" and rest == ["run"]:
            action = text(body.get("action"), "action", 50, True, True)
            return {"job": jobs.start(repo, action, build_commands(action, body.get("params")))}
    raise BadRequest("not found", 404)
