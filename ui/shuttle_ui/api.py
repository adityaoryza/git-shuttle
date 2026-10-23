"""The API routes: what each URL does. Nothing here knows about HTTP."""
import json
import os
import re
import subprocess

from . import API_LEVEL, __version__
from . import actions
from .errors import BadRequest
from .diffs import commit_details, file_diff, worktree_files
from .graph import branch_list, commit_graph
from . import prefs, updates, vault
from .runner import NO_TERMINAL, child_env, git_output, limited, run_shuttle, shuttle_porcelain, shuttle_records, shuttle_stdin, shuttle_text
from .validate import HASH_RE, build_commands, display_name, name as branch_name, relative_path, text
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
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True, **NO_TERMINAL)
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
    remote = subprocess.run(["git", "config", "--get", "shuttle.remote"], cwd=repo["path"], env=child_env(), capture_output=True, **NO_TERMINAL)
    name = branch_name(remote.stdout.decode().strip() or "origin", "shuttle.remote")
    before = remote_refs(repo["path"], name)
    done = subprocess.run(["git", "fetch", "--quiet", "--prune", "--", name], cwd=repo["path"], env=child_env(), capture_output=True, **NO_TERMINAL, timeout=120)
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
        merge, h, mark, subject, queued = (rec.split("\x1f") + ["", "", "", ""])[:5]
        if merge in by_merge:
            by_merge[merge]["commits"].append({"hash": h, "pending": mark == "+", "subject": subject, "in_release": queued if mark == "~" else ""})
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


def addon_records(repo, command, timeout=60, extra=()):
    """The answers of the add-ons that `git shuttle addon cards|tasks --porcelain` gives: [{addon, <key>...}], and the reasons of those that said nothing."""
    out, problems = [], []
    for rec in shuttle_records(repo["path"], ["addon", command, *extra], timeout=timeout):
        if len(rec) < 2:
            continue
        key, _, name = rec[0].partition("=")
        if key == "problem":
            problems.append({"addon": name, "problem": rec[1][:300]})
            continue
        try:
            out.append((name, json.loads(rec[1])))
        except ValueError:
            continue
    return out, problems


def addon_setup(repo, name, body):
    """What an add-on needs from the user (GET), or what the user typed for it (POST). The values go to the add-on on standard input and are never
    kept, logged or sent back: the answer holds only what the add-on says (a secret is shown as set or not)."""
    from .validate_ops import ADDON_RE
    if not ADDON_RE.match(name):
        raise BadRequest("the name of the add-on is not valid")
    if body is None:
        records = shuttle_records(repo["path"], ["addon", "setup", name], timeout=75)
    else:
        values = body.get("values")
        if not isinstance(values, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in values.items()):
            raise BadRequest("values must be an object of texts")
        code, out = shuttle_stdin(repo["path"], ["addon", "setup", name, "--save", "--porcelain"], json.dumps(values).encode("utf-8"))
        if code != 0:
            raise BadRequest(out.strip()[:300] or "the add-on could not be set up")
        records = [r.split("\x1f") for r in out.split("\0") if r]
    try:
        return json.loads(records[0][0])
    except (ValueError, IndexError):
        raise BadRequest("the add-on gave no usable answer", 500)


def conflict_hunks(repo, path):
    """The places where one file is in conflict (git shuttle conflicts FILE --porcelain): both sides, and who last changed the lines of ours."""
    path = relative_path(path)
    try:
        parsed = shuttle_porcelain(repo["path"], "conflicts", extra=[path])
    except BadRequest as error:
        raise BadRequest(str(error), 400)       # the command refuses (nothing waits, the file is not in conflict): a refusal, not a failure
    hunks = {}
    for entry in parsed.get("hunk", []):
        n, start, end, first, last = (entry.split("\x1f") + [""] * 5)[:5]
        hunks[int(n)] = {"n": int(n), "start": int(start), "end": int(end), "from": int(first) if first else None, "to": int(last) if last else None,
                         "before": "", "ours": "", "base": None, "theirs": "", "after": "", "blame": []}
    for key in ("before", "ours", "base", "theirs", "after"):
        for entry in parsed.get(key, []):
            n, _, content = entry.partition("\x1f")
            if int(n) in hunks:
                hunks[int(n)][key] = content
    for entry in parsed.get("blame", []):
        n, sha, subject, author, when, picked, count = (entry.split("\x1f") + [""] * 7)[:7]
        if int(n) in hunks:
            hunks[int(n)]["blame"].append({"sha": sha, "subject": subject, "author": author, "when": when,
                                           "picked": int(picked) if picked else None, "lines": int(count or 0)})
    return {"file": path, "hunks": [hunks[k] for k in sorted(hunks)]}


def trace_json(repo, args):
    try:
        return json.loads(shuttle_text(repo["path"], ["trace"] + args + ["--porcelain"]))
    except ValueError:
        raise BadRequest("the trace cannot be read", 500)


def addon_cards(repo):
    """What the enabled add-ons show for the branch (each answer was checked by the command; nothing here runs an add-on itself)."""
    out, problems = [], []
    for rec in shuttle_records(repo["path"], ["addon", "cards"]):
        if len(rec) < 2:
            continue
        key, _, name = rec[0].partition("=")
        if key == "problem":
            problems.append({"addon": name, "problem": rec[1][:300]})
            continue
        try:
            cards = json.loads(rec[1]).get("cards", [])
        except ValueError:
            continue
        out.append({"addon": name, "cards": cards})
    return out, problems


def deploy_targets(repo):
    """The saved deploy targets of a repository (the settings of git config, read by the command)."""
    names = ["target", "host", "port", "command", "branch", "sudo", "detector", "confirm", "last_time", "last_sha", "last_result"]
    out = []
    for rec in shuttle_records(repo["path"], ["deploy", "--list"]):
        fields = [rec[0].partition("=")[2]] + rec[1:] if rec else []
        fields += [""] * (len(names) - len(fields))
        item = dict(zip(names, fields))
        item["saved"] = vault.saved_at(vault.key_of(repo["path"], item["target"], item["host"], item["port"]))     # when a password was saved for it
        out.append(item)
    return out


def deploy_key(repo, target):
    """The key of the saved password of a target of this repository (it changes with the address: another server, another key)."""
    from .validate_ops import deploy_target
    name = deploy_target(target)
    for item in deploy_targets(repo):
        if item["target"] == name:
            return vault.key_of(repo["path"], name, item["host"], item["port"])
    raise BadRequest("no such server", 404)


def deploy_plan(repo, body):
    """What a deploy of one target would do now: it fetches, checks the branch, and finds the modules. It connects to nothing."""
    from .validate_ops import deploy_target, MODULES_RE
    args = ["deploy", deploy_target(body.get("target")), "--plan"]
    modules = body.get("modules")
    if modules:
        if not isinstance(modules, str) or not MODULES_RE.match(modules):
            raise BadRequest("the modules are not valid: names separated by commas")
        args += ["--modules", modules]
    try:
        return {"plan": shuttle_porcelain(repo["path"], args[0], extra=args[1:])}
    except BadRequest as error:
        raise BadRequest(str(error).replace("error: ", "", 1), 400)


def handle(server, method, route, body):
    store, jobs = server.store, server.jobs
    parts = [p for p in route.split("/") if p]
    if method == "GET" and parts == ["version"]:
        return {"version": __version__, "api": API_LEVEL}
    if method == "GET" and parts == ["prefs"]:
        return {"prefs": prefs.read()}
    if method == "POST" and parts == ["prefs"]:
        return {"prefs": prefs.set_pref(body.get("key"), body.get("value"))}
    if method == "GET" and parts == ["update", "notice"]:
        return updates.notice()
    if method == "POST" and parts == ["update", "notice"]:
        return updates.set_notice(body)
    if method == "POST" and parts == ["update", "check"]:
        return updates.check()
    if method == "POST" and parts == ["update", "apply"]:
        return updates.apply(store)
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
        if method == "POST" and rest == ["conflicts"]:
            return conflict_hunks(repo, body.get("path"))
        if method == "GET" and rest == ["candidates"]:
            return {"candidates": candidates(repo)}
        if method == "POST" and rest == ["fetch"]:
            return fetch(repo)
        if method == "POST" and rest == ["preview"]:
            return preview(repo, body)
        if method == "GET" and rest == ["addons"]:
            return {"addons": [{"name": r[0].partition("=")[2], "state": r[1] if len(r) > 1 else "", "path": r[2] if len(r) > 2 else "",
                                "version": r[3] if len(r) > 3 else "", "flags": r[4].split() if len(r) > 4 and r[4] else [],
                                "hooks": r[5].split() if len(r) > 5 and r[5] else [], "report": len(r) > 6 and r[6] == "on"}
                               for r in shuttle_records(repo["path"], ["addon", "list"]) if r]}
        if len(rest) == 3 and rest[0] == "addons" and rest[2] == "setup" and method in ("GET", "POST"):
            return addon_setup(repo, rest[1], body if method == "POST" else None)
        if method == "GET" and rest == ["addons", "tasks"]:
            found, problems = addon_records(repo, "tasks", timeout=75, extra=["--all"] if body.get("all") == "1" else [])
            return {"tasks": [{"addon": name, "tasks": data.get("tasks", []), "note": data.get("note", "")} for name, data in found], "problems": problems}
        if method == "GET" and rest == ["addons", "available"]:
            return {"available": [{"name": r[0].partition("=")[2], "title": r[1] if len(r) > 1 else "", "description": r[2] if len(r) > 2 else "",
                                   "repo": r[3] if len(r) > 3 else "", "version": r[4] if len(r) > 4 else "", "state": r[5] if len(r) > 5 else "",
                                   "path": r[6] if len(r) > 6 else ""}
                                  for r in shuttle_records(repo["path"], ["addon", "available"]) if r]}
        if method == "GET" and rest == ["trace", "map"]:
            return trace_json(repo, ["map"])
        if method == "GET" and rest == ["trace", "tasks"]:
            return trace_json(repo, ["list"])
        if method == "POST" and rest == ["trace", "show"]:
            from .validate_ops import ADDON_RE, TASK_ID_RE
            addon, task = body.get("addon"), body.get("task")
            if not isinstance(addon, str) or not ADDON_RE.match(addon) or not isinstance(task, str) or not TASK_ID_RE.match(task):
                raise BadRequest("name the add-on and the task")
            return trace_json(repo, ["show", task, "--addon", addon])
        if method == "GET" and rest == ["addons", "cards"]:
            cards, problems = addon_cards(repo)
            return {"cards": cards, "problems": problems}
        if method == "GET" and rest == ["deploy"]:
            return {"targets": deploy_targets(repo), "vault": vault.info()}
        if method == "POST" and rest == ["deploy", "forget-password"]:
            vault.forget(deploy_key(repo, body.get("target")))
            return {"ok": True}
        if method == "POST" and rest == ["deploy", "plan"]:
            return deploy_plan(repo, body)
        if method == "POST" and rest == ["run"]:
            action = text(body.get("action"), "action", 50, True, True)
            params = dict(body["params"]) if isinstance(body.get("params"), dict) else None
            secret, remember_key = None, None
            use_saved, remember = bool(params.pop("use_saved", False)) if params else False, bool(params.pop("remember", False)) if params else False
            if (use_saved or remember) and action not in ("deploy", "deploy-check"):
                raise BadRequest("a saved password is only for a deploy")
            if params and "sudo_password" in params:
                # the password of sudo goes to the deploy and nowhere else: not into the job, the history or the log
                given = params.pop("sudo_password")
                if action not in ("deploy", "deploy-check"):
                    raise BadRequest("a password is only for a deploy")
                if not isinstance(given, str) or not given or len(given) > 256 or "\n" in given or "\0" in given:
                    raise BadRequest("the sudo password is not valid")
                secret = bytearray(given.encode("utf-8"))
                del given
            saved_key = None
            if use_saved and secret is None:
                # the password kept on this computer: read by the job (never sent to the page), wiped when it ends
                saved_key = deploy_key(repo, (params or {}).get("target"))
                if not vault.saved_at(saved_key):
                    raise BadRequest("no password is saved for this server: type it", 400)
            if remember and secret is not None:
                remember_key = deploy_key(repo, (params or {}).get("target"))
            commands = build_commands(action, params)
            return {"job": jobs.start(repo, action, commands, params, text(body.get("label"), "label", 120, False, True), secret=secret,
                                      remember=(remember_key, params.get("target")) if remember_key else None, saved_key=saved_key)}
    raise BadRequest("not found", 404)
