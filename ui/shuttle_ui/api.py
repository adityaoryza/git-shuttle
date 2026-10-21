"""The API routes: what each URL does. Nothing here knows about HTTP."""
import os
import re
import subprocess

from . import API_LEVEL, __version__
from . import actions
from .errors import BadRequest
from .diffs import commit_details, file_diff, worktree_files
from .graph import branch_list, commit_graph
from .runner import child_env, git_output, limited, run_shuttle, shuttle_porcelain, shuttle_records, shuttle_text
from .validate import HASH_RE, build_commands, display_name, name as branch_name, text
from .validate_ops import commitish

MAX_NEW_COMMITS = 300


def repo_summary(repo):
    base = {"id": repo["id"], "name": repo["name"], "path": repo["path"]}
    try:
        base["status"] = shuttle_porcelain(repo["path"], "status")
    except (BadRequest, subprocess.SubprocessError, OSError) as error:
        base["error"] = str(error)
    return base


def register(store, path, name=None):
    if not isinstance(path, str) or not path or "\0" in path or not os.path.isabs(path):
        raise BadRequest("give the absolute path of a repository")
    real = os.path.realpath(path)
    if not os.path.isdir(real):
        raise BadRequest("that folder does not exist")
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
    if done.returncode != 0:
        raise BadRequest("that folder is not a git repository")
    return store.add_repo(os.path.realpath(done.stdout.decode("utf-8", "replace").strip()), display_name(name) if name else None)


def remote_refs(repo_path, remote):
    """{ref: sha} of the remote-tracking branches of one remote."""
    done = git_output(repo_path, "for-each-ref", "--format=%(refname)%1f%(objectname)", "refs/remotes/%s/" % remote)
    refs = {}
    for line in done.stdout.decode("utf-8", "replace").splitlines():
        ref, _, sha = line.partition("\x1f")
        if ref and not ref.endswith("/HEAD"):
            refs[ref] = sha
    return refs


def fetch_summary(repo_path, before, after):
    """What a fetch changed, from the remote-tracking refs before and after it."""
    created = sorted(set(after) - set(before))
    pruned = sorted(set(before) - set(after))
    updated = sorted(ref for ref in after if ref in before and after[ref] != before[ref])
    new_commits = []
    tips = [after[ref] for ref in created + updated]
    if tips:
        argv = ["rev-list", "--max-count=%d" % MAX_NEW_COMMITS] + tips + ["--not"] + sorted(set(before.values()))
        new_commits = git_output(repo_path, *argv).stdout.decode("utf-8", "replace").split()
    return {
        "created": created, "updated": updated, "pruned": pruned,
        "new_commits": len(new_commits), "new_shas": new_commits,
        "up_to_date": not (created or updated or pruned),
    }


def fetch(repo):
    remote = subprocess.run(["git", "config", "--get", "shuttle.remote"], cwd=repo["path"], env=child_env(), capture_output=True)
    name = branch_name(remote.stdout.decode().strip() or "origin", "shuttle.remote")
    before = remote_refs(repo["path"], name)
    done = subprocess.run(["git", "fetch", "--quiet", "--prune", "--", name], cwd=repo["path"], env=child_env(), capture_output=True, timeout=120)
    ok = done.returncode == 0
    return {
        "ok": ok, "remote": name, "output": limited(done.stdout + done.stderr),
        "summary": fetch_summary(repo["path"], before, remote_refs(repo["path"], name)) if ok else None,
    }


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
        extra = {"GIT_SHUTTLE_ASSUME_COMMITTED": "1"} if any(c[0] in ("commit", "stage") for c in commands[:i]) else {}
        made = [c[1] for c in commands[:i] if c[0] == "branch"]
        if made:        # a push after "create a branch": push the branch that the previous step will have made
            extra["GIT_SHUTTLE_ASSUME_BRANCH"] = made[-1]
        extra = extra or None
        code, output = run_shuttle(repo["path"], argv, dry_run=True, extra_env=extra)
        steps.append({"argv": argv, "exit": code, "output": output})
        if code != 0:
            break
    return {"steps": steps, "ok": all(s["exit"] == 0 for s in steps)}


MAX_DIRS = 300


def browse(path):
    """The folders inside one folder of your home (never anything outside it), to pick a repository from; names only, nothing is read."""
    home = os.path.realpath(os.path.expanduser("~"))
    if path in (None, ""):
        path = home
    if not isinstance(path, str) or "\0" in path or len(path) > 1000:
        raise BadRequest("that folder is not valid")
    real = os.path.realpath(os.path.expanduser(path))
    if real != home and not real.startswith(home + os.sep):
        raise BadRequest("only folders inside your home folder can be listed", 403)
    if not os.path.isdir(real):
        raise BadRequest("that folder does not exist", 404)
    dirs = []
    try:
        names = sorted(os.listdir(real), key=str.lower)
    except OSError:
        raise BadRequest("that folder cannot be read", 403)
    for entry in names:
        if entry.startswith(".") and entry != ".config":
            continue
        full = os.path.join(real, entry)
        target = os.path.realpath(full)
        if not os.path.isdir(full) or not (target == home or target.startswith(home + os.sep)):
            continue
        dirs.append({"name": entry, "repo": os.path.exists(os.path.join(full, ".git"))})
        if len(dirs) >= MAX_DIRS:
            break
    return {"path": real, "home": home, "parent": os.path.dirname(real) if real != home else None,
            "repo": os.path.exists(os.path.join(real, ".git")), "dirs": dirs}


def history(store, query):
    def one(key):
        value = query.get(key)
        return value[0] if isinstance(value, list) else value
    before = one("before")
    if before not in (None, "") and not str(before).isdigit():
        raise BadRequest("before is not valid")
    limit = one("limit") or 50
    if not str(limit).isdigit():
        raise BadRequest("limit is not valid")
    result = one("result") or None
    if result is not None and result not in ("done", "stopped", "failed"):
        raise BadRequest("result is not valid")
    since = one("since") or None
    if since is not None and not re.match(r"^\d{4}-\d{2}-\d{2}(T[\d:]{0,8})?$", since):
        raise BadRequest("since is not valid")
    page = store.history_page(before=int(before) if before not in (None, "") else None, limit=int(limit), repo=text(one("repo"), "repo", 200),
                              action=text(one("action"), "action", 50), result=result, q=text(one("q"), "q", 200), since=since)
    page["facets"] = store.facets()
    return page


def stashes(repo):
    return [{"index": int(r[0]), "hash": r[1], "date": r[2], "message": r[3]} for r in shuttle_records(repo["path"], ["stash", "list"]) if len(r) >= 4]


def worktrees(repo):
    return [{"path": r[0], "branch": r[1], "head": r[2], "main": r[3] == "1"} for r in shuttle_records(repo["path"], ["worktree", "list"]) if len(r) >= 4]


def journal(repo, limit=50):
    return [{"id": int(r[0]), "time": r[1], "command": r[2], "state": r[3], "summary": r[4]}
            for r in shuttle_records(repo["path"], ["journal", "--limit", str(limit)]) if len(r) >= 5 and r[0].isdigit()]


def compare(repo, body):
    a, b = commitish(body.get("a"), "a"), commitish(body.get("b") or "HEAD", "b")
    done = shuttle_text(repo["path"], ["compare", a, b, "--porcelain"])
    out = {"a": a, "b": b, "ahead": 0, "behind": 0, "ahead_commits": [], "behind_commits": [], "files": []}
    for rec in done.split("\0"):
        key, _, value = rec.partition("=")
        fields = value.split("\x1f")
        if key in ("ahead", "behind"):
            out[key] = int(value or 0)
        elif key in ("ahead-commit", "behind-commit"):
            out[key.replace("-", "_") + "s"].append({"hash": fields[0], "subject": fields[1] if len(fields) > 1 else ""})
        elif key == "file":
            out["files"].append({"status": fields[0], "path": fields[1] if len(fields) > 1 else "", "old_path": fields[2] if len(fields) > 2 else None})
    return out


def handle(server, method, route, body):
    store, jobs = server.store, server.jobs
    parts = [p for p in route.split("/") if p]
    if method == "GET" and parts == ["version"]:
        return {"version": __version__, "api": API_LEVEL}
    if method == "GET" and parts == ["repos"]:
        return {"repos": [repo_summary(r) for r in store.repos()]}
    if method == "POST" and parts == ["repos"]:
        return {"repo": register(store, body.get("path"), body.get("name"))}
    if method == "GET" and parts == ["history"]:
        return history(store, body)
    if method == "POST" and parts == ["history", "clear"]:
        store.clear_history()
        return {"ok": True}
    if method == "GET" and parts == ["actions"]:
        return {"actions": actions.catalog()}
    if method == "GET" and parts == ["browse"]:
        return browse(body.get("path"))
    if method == "GET" and len(parts) == 2 and parts[0] == "jobs":
        return {"job": jobs.get(parts[1])}
    if len(parts) >= 2 and parts[0] == "repos":
        repo = store.find(parts[1])
        rest = parts[2:]
        if method == "POST" and rest == ["rename"]:
            return {"repo": store.rename_repo(repo["id"], display_name(body.get("name")))}
        if method == "POST" and rest == ["remove"]:
            store.remove_repo(repo["id"])
            return {"ok": True}
        if method == "GET" and rest == ["status"]:
            return {"status": shuttle_porcelain(repo["path"], "status")}
        if rest == ["graph"] and method in ("GET", "POST"):
            return commit_graph(repo["path"], body.get("refs") if method == "POST" else None)
        if method == "GET" and rest == ["branches"]:
            return branch_list(repo["path"])
        if method == "GET" and len(rest) == 2 and rest[0] == "commits":
            return commit_details(repo["path"], rest[1])
        if method == "GET" and rest == ["stashes"]:
            return {"stashes": stashes(repo)}
        if method == "GET" and len(rest) == 2 and rest[0] == "stashes":
            if not rest[1].isdigit() or len(rest[1]) > 4:
                raise BadRequest("the stash number is not valid")
            return {"diff": limited(shuttle_text(repo["path"], ["stash", "show", rest[1], "--porcelain"]).encode())}
        if method == "GET" and rest == ["worktrees"]:
            return {"worktrees": worktrees(repo)}
        if method == "GET" and rest == ["journal"]:
            return {"journal": journal(repo)}
        if method == "POST" and rest == ["compare"]:
            return compare(repo, body)
        if method == "GET" and len(rest) == 3 and rest[0] == "commits" and rest[2] == "link":
            if not HASH_RE.match(rest[1]):
                raise BadRequest("not a commit")
            return {"url": shuttle_text(repo["path"], ["link", rest[1]]).strip()}
        if method == "GET" and len(rest) == 3 and rest[0] == "commits" and rest[2] == "patch":
            if not HASH_RE.match(rest[1]):
                raise BadRequest("not a commit")
            patch = shuttle_text(repo["path"], ["patch", "create", rest[1]])
            if len(patch) > 5 * 1024 * 1024:
                raise BadRequest("the patch is larger than 5 MB")
            return {"patch": patch}
        if method == "GET" and rest == ["worktree"]:
            return worktree_files(repo["path"])
        if method == "POST" and rest == ["diff"]:
            source = text(body.get("source"), "source", 64, True, True)
            old = body.get("old_path")
            return file_diff(repo["path"], source, text(body.get("path"), "path", 500, True, True), old if isinstance(old, str) and old else None, body.get("context"))
        if method == "GET" and rest == ["candidates"]:
            return {"candidates": candidates(repo)}
        if method == "POST" and rest == ["fetch"]:
            return fetch(repo)
        if method == "POST" and rest == ["preview"]:
            return preview(repo, body)
        if method == "POST" and rest == ["run"]:
            action = text(body.get("action"), "action", 50, True, True)
            return {"job": jobs.start(repo, action, build_commands(action, body.get("params")), body.get("params") if isinstance(body.get("params"), dict) else None,
                                      text(body.get("label"), "label", 120, False, True))}
    raise BadRequest("not found", 404)
