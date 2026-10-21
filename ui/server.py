#!/usr/bin/env python3
"""git-shuttle web UI: a local server that shows the state of your repositories and runs git-shuttle for you.

It adds no logic of its own: every action is a git-shuttle command, previewed with --dry-run first. Standard library only.

Security (it runs commands on your repositories, so this matters):
  * it listens on 127.0.0.1 only;
  * every API call needs the token printed at start (a header; the page reads it from the URL fragment);
  * the Host and Origin headers must be this server (DNS rebinding, cross-site calls);
  * a POST must be JSON; nothing is run through a shell; every value is validated;
  * only the repositories you registered can be acted on.
"""
import argparse
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
SHUTTLE = os.path.join(os.path.dirname(HERE), "bin", "git-shuttle")
MAX_BODY = 1024 * 1024
# the only files served under /static/: nothing else in the folder can be fetched
STATIC_FILES = {
    "app.js": ("app.js", "application/javascript; charset=utf-8"),
    "logic.js": ("logic.js", "application/javascript; charset=utf-8"),
    "app.css": ("app.css", "text/css; charset=utf-8"),
}
NAME_RE = re.compile(r"^[A-Za-z0-9._/\-]{1,200}$")
HASH_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
TRAILER_RE = re.compile(r"^[A-Za-z0-9\- ]{0,200}$")


class BadRequest(Exception):
    """The request is refused: the message is for the user."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------------------------------------------------
# state kept in the config folder: the repositories you registered, and what was run
# ---------------------------------------------------------------------------------------------------------------------

def config_dir():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, "git-shuttle")
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


class Store:
    def __init__(self, directory):
        self.dir = directory
        self.lock = threading.Lock()
        self.repos_file = os.path.join(directory, "repos.json")
        self.history_file = os.path.join(directory, "history.jsonl")

    def repos(self):
        try:
            with open(self.repos_file, encoding="utf-8") as f:
                data = json.load(f)
            return [r for r in data if isinstance(r, dict) and "id" in r and "path" in r]
        except (OSError, ValueError):
            return []

    def save_repos(self, repos):
        tmp = self.repos_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(repos, f, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.repos_file)

    def add_repo(self, path):
        with self.lock:
            repos = self.repos()
            for r in repos:
                if r["path"] == path:
                    return r
            repo = {"id": uuid.uuid4().hex[:10], "path": path, "name": os.path.basename(path)}
            repos.append(repo)
            self.save_repos(repos)
            return repo

    def remove_repo(self, repo_id):
        with self.lock:
            repos = [r for r in self.repos() if r["id"] != repo_id]
            self.save_repos(repos)

    def find(self, repo_id):
        for r in self.repos():
            if r["id"] == repo_id:
                return r
        raise BadRequest("unknown repository", 404)

    def log(self, entry):
        with self.lock:
            with open(self.history_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            os.chmod(self.history_file, 0o600)

    def history(self, limit=100):
        try:
            with open(self.history_file, encoding="utf-8") as f:
                lines = f.readlines()[-limit:]
        except OSError:
            return []
        out = []
        for line in lines:
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return list(reversed(out))


# ---------------------------------------------------------------------------------------------------------------------
# running git-shuttle
# ---------------------------------------------------------------------------------------------------------------------

def child_env(extra=None):
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "GIT_EDITOR": "true", "NO_COLOR": "1"})
    if extra:
        env.update(extra)
    return env


def run_shuttle(repo_path, args, dry_run=False, timeout=120, extra_env=None):
    """One git-shuttle command in a repository; returns (exit status, output)."""
    argv = [SHUTTLE, "-n" if dry_run else "-y"] + list(args)
    try:
        done = subprocess.run(argv, cwd=repo_path, env=child_env(extra_env), capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    return done.returncode, (done.stdout + done.stderr).decode("utf-8", "replace")


def parse_porcelain(raw):
    """NUL separated key=value records -> a dict; the repeating keys become lists."""
    repeating = {"file", "conflict", "blocker", "candidate", "commit"}
    out = {}
    for rec in raw.split(b"\0"):
        if not rec:
            continue
        key, _, value = rec.decode("utf-8", "replace").partition("=")
        if key in repeating:
            out.setdefault(key, []).append(value)
        else:
            out[key] = value
    for key in repeating:
        out.setdefault(key, [])
    return out


def shuttle_porcelain(repo_path, command, timeout=60):
    done = subprocess.run([SHUTTLE, command, "--porcelain"], cwd=repo_path, env=child_env(), capture_output=True, timeout=timeout)
    if done.returncode != 0:
        raise BadRequest((done.stdout + done.stderr).decode("utf-8", "replace").strip() or "git-shuttle failed", 500)
    return parse_porcelain(done.stdout)


# ---------------------------------------------------------------------------------------------------------------------
# validation: what the page may ask for. Every value becomes an argument of git-shuttle, never a shell word.
# ---------------------------------------------------------------------------------------------------------------------

def text(value, field, limit=2000, required=False, single_line=False):
    if value is None or value == "":
        if required:
            raise BadRequest("%s is required" % field)
        return ""
    if not isinstance(value, str):
        raise BadRequest("%s must be text" % field)
    if "\0" in value or len(value) > limit:
        raise BadRequest("%s is not valid" % field)
    if single_line and ("\n" in value or "\r" in value):
        raise BadRequest("%s must be on one line" % field)
    return value


def name(value, field, required=True):
    if value is None or value == "":
        if required:
            raise BadRequest("%s is required" % field)
        return ""
    if not isinstance(value, str) or not NAME_RE.match(value) or value.startswith("-") or ".." in value:
        raise BadRequest("%s is not a valid branch name" % field)
    return value


def relative_path(value):
    if not isinstance(value, str) or not value or "\0" in value or len(value) > 500:
        raise BadRequest("a path is not valid")
    if value.startswith("/") or value.startswith("-") or any(part == ".." for part in value.split("/")):
        raise BadRequest("paths must stay inside the repository: %r" % value)
    return value


def flag(value):
    return bool(value) if isinstance(value, (bool, int)) else False


def build_commands(action, params):
    """The list of git-shuttle argument lists an action stands for (run in order, stopping at the first failure)."""
    p = params if isinstance(params, dict) else {}
    if action == "start":
        return [["start", text(p.get("name"), "name", 200, True, True)]]
    if action == "stage":
        paths = [relative_path(x) for x in (p.get("paths") or [])]
        if not paths:
            raise BadRequest("name the paths to stage")
        return [["stage", "--"] + paths]
    if action == "sync":
        return [["sync"]]
    if action == "push":
        return [["push"] + (["--force-with-lease"] if flag(p.get("force")) else [])]
    if action == "continue":
        return [["continue"]]
    if action == "abort":
        return [["abort"]]
    if action == "ship":
        commands = []
        stage = [relative_path(x) for x in (p.get("stage") or [])]
        if stage:
            commands.append(["stage", "--"] + stage)
        for c in (p.get("commits") or []):
            if not isinstance(c, dict):
                raise BadRequest("a commit is not valid")
            msg = text(c.get("message"), "message", 2000, True)
            paths = [relative_path(x) for x in (c.get("paths") or [])]
            if not paths:
                raise BadRequest("a commit needs its paths")
            commands.append(["commit", "-m", msg, "--"] + paths)
        ship = ["ship"]
        if flag(p.get("pr")):
            ship.append("--pr")
            title = text(p.get("title"), "title", 300, False, True)
            if title:
                ship += ["--title", title]
            body = text(p.get("body"), "body", 60000)
            if body:
                ship += ["--body", body]
            if flag(p.get("draft")):
                ship.append("--draft")
        elif flag(p.get("no_sync")):
            ship.append("--no-sync")
        commands.append(ship)
        return commands
    if action == "release":
        onto = text(p.get("onto"), "onto", 200, True, True)
        if onto != "auto":
            onto = name(onto, "onto")
        args = ["release", "--onto", onto]
        if p.get("from"):
            args += ["--from", name(p.get("from"), "from")]
        if p.get("strategy"):
            if p.get("strategy") not in ("ours", "theirs"):
                raise BadRequest("strategy must be ours or theirs")
            args += ["--strategy-option", p["strategy"]]
        if flag(p.get("push")):
            args.append("--push")
        commits = p.get("commits") or []
        if not commits:
            raise BadRequest("choose at least one commit")
        for h in commits:
            if not isinstance(h, str) or not HASH_RE.match(h):
                raise BadRequest("a commit is not valid")
            args.append(h)
        return [args]
    if action == "pr":
        args = ["pr"]
        if p.get("base"):
            args += ["--base", name(p.get("base"), "base")]
        title = text(p.get("title"), "title", 300, False, True)
        if title:
            args += ["--title", title]
        body = text(p.get("body"), "body", 60000)
        if body:
            args += ["--body", body]
        if flag(p.get("draft")):
            args.append("--draft")
        return [args]
    if action == "init":
        args = ["init"]
        for key, opt in (("integration", "--integration"), ("release", "--release"), ("base", "--base")):
            if p.get(key):
                args += [opt, name(p[key], key)]
        if p.get("protected"):
            args += ["--protected", " ".join(name(x, "protected") for x in str(p["protected"]).replace(",", " ").split())]
        if "messagePattern" in p:
            args += ["--message-pattern", text(p.get("messagePattern"), "messagePattern", 500, False, True)]
        if "forbidTrailers" in p:
            value = text(p.get("forbidTrailers"), "forbidTrailers", 200, False, True)
            if not TRAILER_RE.match(value):
                raise BadRequest("forbidTrailers is not valid")
            args += ["--forbid-trailers", value]
        if "branchPrefix" in p:
            args += ["--branch-prefix", text(p.get("branchPrefix"), "branchPrefix", 100, False, True)]
        if "releasePattern" in p:
            args += ["--release-pattern", text(p.get("releasePattern"), "releasePattern", 200, False, True)]
        if "upgradeCommand" in p:
            args += ["--upgrade-command", text(p.get("upgradeCommand"), "upgradeCommand", 500, False, True)]
        if flag(p.get("hook")):
            args.append("--hook")
        return [args]
    raise BadRequest("unknown action")


# ---------------------------------------------------------------------------------------------------------------------
# jobs: an action runs in a thread, one at a time per repository
# ---------------------------------------------------------------------------------------------------------------------

class Jobs:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()
        self.jobs = {}
        self.busy = {}  # repo id -> job id

    def start(self, repo, action, commands):
        with self.lock:
            if repo["id"] in self.busy:
                raise BadRequest("another action is running in this repository", 409)
            job_id = uuid.uuid4().hex[:12]
            job = {"id": job_id, "repo": repo["id"], "action": action, "state": "running", "exit": None,
                   "steps": [{"argv": c, "state": "todo", "exit": None, "output": ""} for c in commands],
                   "started": time.time(), "finished": None}
            self.jobs[job_id] = job
            self.busy[repo["id"]] = job_id
        threading.Thread(target=self._run, args=(repo, job), daemon=True).start()
        return job_id

    def _run(self, repo, job):
        exit_code = 0
        try:
            for step in job["steps"]:
                step["state"] = "running"
                code, output = run_shuttle(repo["path"], step["argv"], dry_run=False, timeout=900)
                step["exit"], step["output"] = code, output
                step["state"] = "done" if code == 0 else "stopped"
                if code != 0:
                    exit_code = code
                    break
        except Exception as error:  # a bug here must not leave the repository marked busy
            exit_code = 1
            job["steps"][-1]["output"] += "\ninternal error: %s" % error
        finally:
            job["exit"] = exit_code
            job["finished"] = time.time()
            job["state"] = "done" if exit_code == 0 else "stopped" if exit_code == 2 else "failed"
            with self.lock:
                self.busy.pop(repo["id"], None)
            self.store.log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "repo": repo["name"], "action": job["action"],
                            "state": job["state"], "exit": exit_code,
                            "commands": ["git shuttle " + " ".join(s["argv"][:3]) for s in job["steps"]]})

    def get(self, job_id):
        job = self.jobs.get(job_id)
        if job is None:
            raise BadRequest("unknown job", 404)
        return job


# ---------------------------------------------------------------------------------------------------------------------
# the HTTP server
# ---------------------------------------------------------------------------------------------------------------------

def repo_summary(repo):
    try:
        status = shuttle_porcelain(repo["path"], "status")
    except (BadRequest, subprocess.SubprocessError, OSError) as error:
        return {"id": repo["id"], "name": repo["name"], "path": repo["path"], "error": str(error)}
    return {"id": repo["id"], "name": repo["name"], "path": repo["path"], "status": status}


class Handler(BaseHTTPRequestHandler):
    server_version = "git-shuttle-ui"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # the access log would print tokens in URLs of other tools: keep it quiet
        if self.server.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- plumbing
    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def _allowed_hosts(self):
        port = self.server.server_address[1]
        return {"127.0.0.1:%d" % port, "localhost:%d" % port}

    def _check_origin(self):
        host = self.headers.get("Host", "")
        if host not in self._allowed_hosts():
            raise BadRequest("this server answers only on its own address", 403)
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {"http://" + h for h in self._allowed_hosts()}:
            raise BadRequest("cross-site request refused", 403)

    def _check_token(self):
        given = self.headers.get("X-Shuttle-Token", "")
        if not hmac.compare_digest(given.encode(), self.server.token.encode()):
            raise BadRequest("missing or wrong token", 401)

    def _json_body(self):
        if (self.headers.get("Content-Type", "").split(";")[0].strip().lower()) != "application/json":
            raise BadRequest("send JSON", 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise BadRequest("bad Content-Length")
        if length < 0 or length > MAX_BODY:
            raise BadRequest("the request is too large", 413)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise BadRequest("the body is not valid JSON")
        if not isinstance(data, dict):
            raise BadRequest("the body must be a JSON object")
        return data

    def _dispatch(self, method):
        try:
            self._check_origin()
            path = urlparse(self.path).path
            if method == "GET" and path in ("/", "/index.html"):
                with open(os.path.join(HERE, "static", "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            if method == "GET" and path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            if method == "GET" and path.startswith("/static/"):
                asset = STATIC_FILES.get(path[len("/static/"):])
                if asset is None:
                    raise BadRequest("not found", 404)
                with open(os.path.join(HERE, "static", asset[0]), "rb") as f:
                    return self._send(200, f.read(), asset[1])
            if not path.startswith("/api/"):
                raise BadRequest("not found", 404)
            self._check_token()
            body = self._json_body() if method == "POST" else {}
            return self._send(200, self._api(method, path[len("/api/"):], body))
        except BadRequest as error:
            return self._send(error.status, {"error": str(error)})
        except Exception as error:  # never leave a request without an answer
            return self._send(500, {"error": "internal error: %s" % error})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._send(405, {"error": "method not allowed"})

    do_DELETE = do_PATCH = do_PUT

    # -- the API
    def _api(self, method, route, body):
        store, jobs = self.server.store, self.server.jobs
        parts = [p for p in route.split("/") if p]
        if method == "GET" and parts == ["repos"]:
            return {"repos": [repo_summary(r) for r in store.repos()]}
        if method == "POST" and parts == ["repos"]:
            return {"repo": self._register(body.get("path"))}
        if method == "GET" and parts == ["history"]:
            return {"history": store.history()}
        if method == "GET" and len(parts) == 2 and parts[0] == "jobs":
            job = jobs.get(parts[1])
            return {"job": job}
        if len(parts) >= 2 and parts[0] == "repos":
            repo = store.find(parts[1])
            rest = parts[2:]
            if method == "POST" and rest == ["remove"]:
                store.remove_repo(repo["id"])
                return {"ok": True}
            if method == "GET" and rest == ["status"]:
                return {"status": shuttle_porcelain(repo["path"], "status")}
            if method == "GET" and rest == ["candidates"]:
                return {"candidates": self._candidates(repo)}
            if method == "POST" and rest == ["fetch"]:
                return self._fetch(repo)
            if method == "POST" and rest == ["preview"]:
                return self._preview(repo, body)
            if method == "POST" and rest == ["run"]:
                action = text(body.get("action"), "action", 50, True, True)
                commands = build_commands(action, body.get("params"))
                return {"job": jobs.start(repo, action, commands)}
        raise BadRequest("not found", 404)

    def _register(self, path):
        if not isinstance(path, str) or not path or "\0" in path or not os.path.isabs(path):
            raise BadRequest("give the absolute path of a repository")
        real = os.path.realpath(path)
        if not os.path.isdir(real):
            raise BadRequest("that folder does not exist")
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
        if done.returncode != 0:
            raise BadRequest("that folder is not a git repository")
        root = os.path.realpath(done.stdout.decode("utf-8", "replace").strip())
        return self.server.store.add_repo(root)

    def _fetch(self, repo):
        remote = subprocess.run(["git", "config", "--get", "shuttle.remote"], cwd=repo["path"], env=child_env(), capture_output=True)
        name_ = remote.stdout.decode().strip() or "origin"
        if not NAME_RE.match(name_):
            raise BadRequest("shuttle.remote is not a valid remote name")
        done = subprocess.run(["git", "fetch", "--quiet", name_], cwd=repo["path"], env=child_env(), capture_output=True, timeout=120)
        return {"ok": done.returncode == 0, "output": (done.stdout + done.stderr).decode("utf-8", "replace")}

    def _candidates(self, repo):
        raw = shuttle_porcelain(repo["path"], "candidates")
        merges = []
        by_merge = {}
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

    def _preview(self, repo, body):
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


class UIServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, store, token, verbose=False):
        super().__init__(address, Handler)
        self.store = store
        self.token = token
        self.jobs = Jobs(store)
        self.verbose = verbose


def make_server(port=0, store=None, token=None, verbose=False):
    """A server on 127.0.0.1 (never another interface); port 0 picks a free one."""
    store = store or Store(config_dir())
    token = token or secrets.token_urlsafe(32)
    return UIServer(("127.0.0.1", port), store, token, verbose)


def open_browser(url):
    for opener in (["wslview", url], ["xdg-open", url], ["open", url], ["explorer.exe", url]):
        try:
            if subprocess.run(["which", opener[0]], capture_output=True).returncode == 0:
                subprocess.Popen(opener, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
        except OSError:
            continue
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(prog="git shuttle ui", description="the git-shuttle web UI (local, 127.0.0.1 only)")
    parser.add_argument("--port", type=int, default=7788, help="default 7788; another free port is used when it is taken")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    parser.add_argument("--repo", action="append", default=[], help="register a repository (repeatable)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    store = Store(config_dir())
    for path in args.repo:
        real = os.path.realpath(path)
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
        if done.returncode != 0:
            sys.exit("not a git repository: %s" % path)
        store.add_repo(os.path.realpath(done.stdout.decode().strip()))
    try:
        server = make_server(args.port, store, verbose=args.verbose)
    except OSError:
        server = make_server(0, store, verbose=args.verbose)
    url = "http://127.0.0.1:%d/#token=%s" % (server.server_address[1], server.token)
    print("git-shuttle UI: %s" % url, flush=True)
    print("It listens on 127.0.0.1 only. Keep this link private: it holds the token. Stop with Ctrl-C.", flush=True)
    if not args.no_open:
        open_browser(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
