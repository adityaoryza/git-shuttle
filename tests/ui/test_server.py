"""Tests of the web UI server: security first, then every action against throw-away repositories (no network)."""
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui"))
from shuttle_ui import cli, http as ui_http  # noqa: E402
from shuttle_ui.store import Store  # noqa: E402

os.environ.update({
    "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "NO_COLOR": "1",
    "GIT_AUTHOR_NAME": "Tester", "GIT_AUTHOR_EMAIL": "tester@example.com",
    "GIT_COMMITTER_NAME": "Tester", "GIT_COMMITTER_EMAIL": "tester@example.com",
    "GIT_EDITOR": "true", "GIT_TERMINAL_PROMPT": "0",
})


def git(cwd, *args, check=True):
    done = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True)
    if check and done.returncode != 0:
        raise AssertionError("git %s failed: %s" % (" ".join(args), done.stderr))
    return done.stdout.strip()


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


class World:
    """A bare remote, a clone with main / develop / release, and a fake gh."""

    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="shuttle-ui-test.")
        self.remote = os.path.join(self.root, "remote.git")
        self.work = os.path.join(self.root, "my work")
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", self.remote], check=True)
        subprocess.run(["git", "clone", "-q", self.remote, self.work], check=True, capture_output=True)
        git(self.work, "checkout", "-q", "-b", "main")
        write(os.path.join(self.work, "file.txt"), "base\n")
        git(self.work, "add", "file.txt"); git(self.work, "commit", "-q", "-m", "base"); git(self.work, "push", "-q", "-u", "origin", "main")
        git(self.work, "checkout", "-q", "-b", "develop"); write(os.path.join(self.work, "file.txt"), "base\ndev\n")
        git(self.work, "commit", "-q", "-am", "develop start"); git(self.work, "push", "-q", "-u", "origin", "develop")
        git(self.work, "checkout", "-q", "-b", "release", "main"); git(self.work, "push", "-q", "-u", "origin", "release")
        git(self.work, "checkout", "-q", "main")
        git(self.work, "remote", "set-head", "origin", "main", check=False)
        subprocess.run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], cwd=self.remote, check=True)
        git(self.work, "config", "shuttle.integration", "develop")
        git(self.work, "config", "shuttle.release", "release")
        self.gh_log = os.path.join(self.root, "gh.log")
        self.gh = os.path.join(self.root, "gh")
        write(self.gh, '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + self.gh_log + '"\necho https://example.com/pull/1\n')
        os.chmod(self.gh, 0o755)
        os.environ["GIT_SHUTTLE_GH"] = self.gh
        self.config = os.path.join(self.root, "config")
        os.makedirs(self.config)

    def feature(self, name, files):
        git(self.work, "checkout", "-q", "-b", name, "develop")
        for path, content in files.items():
            write(os.path.join(self.work, path), content)
        return name

    def remote_log(self, branch):
        return git(self.remote, "log", "--format=%s", branch).splitlines()

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = World()
        cls.store = Store(cls.world.config)
        cls.server = cli.make_server(0, cls.store, token="test-token-123")
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.repo = cls.store.add_repo(os.path.realpath(cls.world.work))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.world.close()

    # -- a raw request, so that headers can be wrong on purpose
    def request(self, method, path, body=None, headers=None, token=True, host=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        hdrs = {"Host": host or "127.0.0.1:%d" % self.port}
        if token:
            hdrs["X-Shuttle-Token"] = "test-token-123"
        payload = raw
        if body is not None:
            payload = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        try:
            parsed = json.loads(data.decode()) if data else None
        except ValueError:
            parsed = None
        return resp.status, parsed, data, dict(resp.getheaders())

    def api(self, method, route, body=None, **kw):
        status, data, _, _ = self.request(method, "/api/" + route, body, **kw)
        return status, data

    def rid(self):
        return self.repo["id"]

    def run_job(self, action, params=None, timeout=60):
        status, data = self.api("POST", "repos/%s/run" % self.rid(), {"action": action, "params": params or {}})
        self.assertEqual(status, 200, data)
        job_id = data["job"]
        deadline = time.time() + timeout
        while time.time() < deadline:
            _, d = self.api("GET", "jobs/" + job_id)
            if d["job"]["state"] != "running":
                return d["job"]
            time.sleep(0.1)
        self.fail("the job did not finish")


class TestSecurity(Base):
    def test_listens_on_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_page_is_served_without_token_and_has_no_secret(self):
        status, _, data, headers = self.request("GET", "/", token=False)
        self.assertEqual(status, 200)
        self.assertNotIn(b"test-token-123", data)
        self.assertIn("text/html", headers["Content-Type"])

    def test_only_the_listed_static_files_are_served(self):
        for name, ctype in (("js/main.js", "javascript"), ("js/logic.js", "javascript"), ("vendor/preact-htm.js", "javascript"), ("css/app.css", "text/css")):
            status, _, data, headers = self.request("GET", "/static/" + name, token=False)
            self.assertEqual(status, 200, name)
            self.assertIn(ctype, headers["Content-Type"])
            self.assertNotIn(b"test-token-123", data)
        for bad in ("../cli.py", "%2e%2e/cli.py", "..%2fcli.py", "js/../../cli.py", "js/../../__init__.py", "vendor/README.md", "js", "js/", "", "nothing.js", "%2e%2e%2f%2e%2e%2fbin/git-shuttle", "/etc/passwd", "//etc/passwd"):
            self.assertEqual(self.request("GET", "/static/" + bad, token=False)[0], 404, bad)

    def test_icons_and_the_theme_script_are_served_with_the_right_types(self):
        for name, ctype, start in (("favicon.svg", "image/svg+xml", b"<svg"), ("favicon-32.png", "image/png", b"\x89PNG"),
                                   ("apple-touch-icon.png", "image/png", b"\x89PNG"), ("favicon.ico", "image/x-icon", b"\0\0\1\0"),
                                   ("js/theme-init.js", "javascript", b"/*")):
            status, _, data, headers = self.request("GET", "/static/" + name, token=False)
            self.assertEqual(status, 200, name)
            self.assertIn(ctype, headers["Content-Type"], name)
            self.assertTrue(data.startswith(start), name)
        status, _, data, headers = self.request("GET", "/favicon.ico", token=False)
        self.assertEqual((status, headers["Content-Type"]), (200, "image/x-icon"), "the browser's own request for the icon is answered")
        self.assertTrue(data.startswith(b"\0\0\1\0"))
        svg = self.request("GET", "/static/favicon.svg", token=False)[2]
        self.assertNotIn(b"<script", svg)
        self.assertNotIn(b"onload", svg)

    def test_the_page_links_the_icons_and_loads_the_theme_before_the_styles(self):
        page = self.request("GET", "/", token=False)[2].decode()
        for needle in ('rel="icon" href="/static/favicon.svg"', 'rel="apple-touch-icon"', 'src="/static/js/theme-init.js"'):
            self.assertIn(needle, page)
        self.assertLess(page.index("theme-init.js"), page.index("app.css"), "the theme is set before the styles are used")
        self.assertNotIn("<script>", page)

    def test_files_of_a_type_that_is_not_listed_are_not_served(self):
        for bad in ("favicon.svg.bak", "../__init__.py", "js/theme.js.map", "favicon.txt"):
            self.assertEqual(self.request("GET", "/static/" + bad, token=False)[0], 404, bad)

    def test_version_handshake(self):
        from shuttle_ui import API_LEVEL, __version__
        status, data = self.api("GET", "version")
        self.assertEqual(status, 200, data)
        self.assertEqual(data, {"version": __version__, "api": API_LEVEL})
        self.assertIsInstance(data["api"], int)
        self.assertGreaterEqual(data["api"], 2, "the page needs at least level 2")
        self.assertEqual(self.api("GET", "version", token=False)[0], 401, "it needs the token like the rest")
        self.assertEqual(self.api("POST", "version", {})[0], 404, "only GET")
        page = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui", "shuttle_ui", "static", "js", "version.js")).read()
        self.assertEqual(int(re.search(r"REQUIRED_API = (\d+)", page).group(1)), API_LEVEL, "bump both together")

    def test_a_missing_route_answers_exactly_not_found_so_that_the_page_can_tell_an_old_server(self):
        status, data = self.api("GET", "no/such/route")
        self.assertEqual((status, data), (404, {"error": "not found"}))
        self.assertEqual(self.api("GET", "repos/nope/status")[1], {"error": "unknown repository"}, "a real 404 says something else")

    def test_the_graph_lists_commits_with_parents_and_refs(self):
        status, data = self.api("GET", "repos/%s/graph" % self.rid())
        self.assertEqual(status, 200, data)
        self.assertGreaterEqual(len(data["commits"]), 1)
        first = data["commits"][0]
        self.assertEqual(set(first), {"sha", "parents", "author", "time", "refs", "subject"})
        self.assertIn("origin", data["remotes"])
        self.assertTrue(any(r.startswith("HEAD -> ") for c in data["commits"] for r in c["refs"]))

    def test_the_page_runs_no_inline_script(self):
        _, _, data, headers = self.request("GET", "/", token=False)
        self.assertNotIn(b"<script>", data)
        self.assertIn("script-src 'self'", headers.get("Content-Security-Policy", ""))
        self.assertNotIn("unsafe-inline", headers.get("Content-Security-Policy", ""))

    def test_security_headers(self):
        _, _, _, headers = self.request("GET", "/", token=False)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertIn("frame-ancestors 'none'", headers.get("Content-Security-Policy", ""))
        self.assertEqual(headers.get("Cache-Control"), "no-store")

    def test_api_needs_the_token(self):
        self.assertEqual(self.api("GET", "repos", token=False)[0], 401)
        self.assertEqual(self.request("GET", "/api/repos", headers={"X-Shuttle-Token": "nope"}, token=False)[0], 401)
        self.assertEqual(self.request("GET", "/api/repos", headers={"X-Shuttle-Token": ""}, token=False)[0], 401)
        self.assertEqual(self.api("GET", "repos")[0], 200)

    def test_token_in_the_url_is_not_accepted(self):
        status, _, _, _ = self.request("GET", "/api/repos?token=test-token-123", token=False)
        self.assertEqual(status, 401)

    def test_wrong_host_is_refused_even_with_the_token(self):
        for host in ("evil.example.com", "127.0.0.1:1", "localhost", "127.0.0.1"):
            self.assertEqual(self.request("GET", "/api/repos", host=host)[0], 403, host)
            self.assertEqual(self.request("GET", "/", host=host, token=False)[0], 403, host)
        self.assertEqual(self.request("GET", "/api/repos", host="localhost:%d" % self.port)[0], 200)

    def test_cross_site_origin_is_refused(self):
        self.assertEqual(self.request("POST", "/api/repos/%s/preview" % self.rid(), {"action": "sync"}, headers={"Origin": "https://evil.example.com"})[0], 403)
        self.assertEqual(self.request("POST", "/api/repos/%s/preview" % self.rid(), {"action": "sync"}, headers={"Origin": "null"})[0], 403)
        ok = self.request("POST", "/api/repos/%s/preview" % self.rid(), {"action": "sync"}, headers={"Origin": "http://127.0.0.1:%d" % self.port})[0]
        self.assertEqual(ok, 200)

    def test_post_must_be_json(self):
        for ctype in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data"):
            status, _, _, _ = self.request("POST", "/api/repos", raw=b'{"path": "/tmp"}', headers={"Content-Type": ctype})
            self.assertEqual(status, 415, ctype)
        self.assertEqual(self.request("POST", "/api/repos", raw=b"{not json", headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("POST", "/api/repos", raw=b"[1,2]", headers={"Content-Type": "application/json"})[0], 400)
        # the size is read from the header: the server answers before reading a body that large
        self.assertEqual(self.request("POST", "/api/repos", raw=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(ui_http.MAX_BODY + 10)})[0], 413)

    def test_other_methods_are_refused(self):
        for method in ("PUT", "DELETE", "PATCH"):
            self.assertEqual(self.request(method, "/api/repos")[0], 405, method)

    def test_unknown_routes_and_repositories(self):
        self.assertEqual(self.api("GET", "nothing")[0], 404)
        self.assertEqual(self.request("GET", "/etc/passwd", token=False)[0], 404)
        self.assertEqual(self.api("GET", "repos/doesnotexist/status")[0], 404)
        self.assertEqual(self.api("GET", "repos/..%2F..%2Fetc/status")[0], 404)
        self.assertEqual(self.api("GET", "jobs/doesnotexist")[0], 404)

    def test_only_registered_repositories(self):
        other = tempfile.mkdtemp(prefix="shuttle-unregistered.")
        try:
            subprocess.run(["git", "init", "-q", other], check=True)
            self.assertEqual(self.api("GET", "repos/%s/status" % os.path.basename(other))[0], 404)
            self.assertEqual(self.api("POST", "repos", {"path": "relative/path"})[0], 400)
            self.assertEqual(self.api("POST", "repos", {"path": "/no/such/folder"})[0], 400)
            plain = tempfile.mkdtemp(prefix="shuttle-plain.")
            try:
                self.assertEqual(self.api("POST", "repos", {"path": plain})[0], 400)
            finally:
                shutil.rmtree(plain)
            status, data = self.api("POST", "repos", {"path": other})
            self.assertEqual(status, 200)
            again = self.api("POST", "repos", {"path": other})[1]
            self.assertEqual(data["repo"]["id"], again["repo"]["id"], "registering twice gives the same repository")
            self.api("POST", "repos/%s/remove" % data["repo"]["id"], {})
            self.assertEqual(self.api("GET", "repos/%s/status" % data["repo"]["id"])[0], 404)
        finally:
            shutil.rmtree(other, ignore_errors=True)

    def test_values_are_validated(self):
        bad = [
            ("release", {"onto": "-x", "commits": ["abcdef1"]}),
            ("release", {"onto": "a b", "commits": ["abcdef1"]}),
            ("release", {"onto": "a/../b", "commits": ["abcdef1"]}),
            ("release", {"onto": "ok", "commits": ["not-a-hash"]}),
            ("release", {"onto": "ok", "commits": []}),
            ("release", {"onto": "ok", "commits": ["abcdef1"], "strategy": "wild"}),
            ("release", {"onto": "ok", "commits": ["abcdef1"], "from": "x;y"}),
            ("ship", {"commits": [{"message": "m", "paths": ["../etc/passwd"]}]}),
            ("ship", {"commits": [{"message": "m", "paths": ["/etc/passwd"]}]}),
            ("ship", {"commits": [{"message": "m", "paths": ["--all"]}]}),
            ("ship", {"commits": [{"message": "m", "paths": []}]}),
            ("ship", {"commits": [{"message": "", "paths": ["a"]}]}),
            ("ship", {"commits": [{"message": "a\0b", "paths": ["a"]}]}),
            ("ship", {"commits": ["not a dict"]}),
            ("start", {"name": ""}),
            ("start", {"name": "two\nlines"}),
            ("start", {"name": 5}),
            ("pr", {"base": "bad name"}),
            ("init", {"integration": "x;y"}),
            ("init", {"forbidTrailers": "bad!name"}),
            ("switch", {"name": "-x"}),
            ("switch", {"name": "a b"}),
            ("switch", {}),
            ("branch", {"name": "ok", "commit": "--all"}),
            ("branch", {"name": "ok", "commit": 5}),
            ("branch", {"name": "x;y"}),
            ("cherry-pick", {"commits": []}),
            ("cherry-pick", {"commits": ["--abort"]}),
            ("cherry-pick", {"commits": "abcdef1"}),
            ("cherry-pick", {"commits": ["abcdef1"], "strategy": "wild"}),
            ("cherry-pick", {"commits": ["abcdef1"] * 101}),
            ("rm -rf", {}),
            ("", {}),
        ]
        for action, params in bad:
            status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": action, "params": params})
            self.assertEqual(status, 400, (action, params, data))

    def test_shell_characters_are_data_not_commands(self):
        marker = os.path.join(self.world.root, "pwned")
        evil = '"; touch %s; echo "$(touch %s)` touch %s `' % (marker, marker, marker)
        self.world.feature("feat/evil", {"ev_a/evil.txt": "x\n"})
        git(self.world.work, "add", "-A")
        job = self.run_job("ship", {"commits": [{"message": evil, "paths": ["ev_a"]}], "no_sync": False})
        self.assertFalse(os.path.exists(marker), "the message was run as a command")
        self.assertEqual(git(self.world.work, "log", "-1", "--format=%s", "feat/evil"), evil)
        self.assertEqual(job["state"], "done", job)
        git(self.world.work, "checkout", "-q", "main")

    def test_a_branch_name_cannot_carry_a_command(self):
        marker = os.path.join(self.world.root, "pwned2")
        for value in ("x;touch %s" % marker, "$(touch %s)" % marker, "a b"):
            status, _ = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "release", "params": {"onto": value, "commits": ["abcdef1"]}})
            self.assertEqual(status, 400)
        self.assertFalse(os.path.exists(marker))


class TestActions(Base):
    def setUp(self):
        git(self.world.work, "checkout", "-q", "main", check=False)

    def test_repos_and_status(self):
        status, data = self.api("GET", "repos")
        self.assertEqual(status, 200)
        repo = [r for r in data["repos"] if r["id"] == self.rid()][0]
        self.assertEqual(repo["status"]["config.integration"], "develop")
        self.assertEqual(repo["status"]["branch"], "main")
        self.assertEqual(repo["status"]["protected"], "1")
        status, data = self.api("GET", "repos/%s/status" % self.rid())
        self.assertEqual(status, 200)
        self.assertIn("blocker", data["status"])

    def test_start_creates_the_branch(self):
        job = self.run_job("start", {"name": "My Task"})
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(git(self.world.work, "branch", "--show-current"), "feature/my_task")
        git(self.world.work, "checkout", "-q", "main")

    def test_branches_switch_branch_here_and_cherry_pick(self):
        work = self.world.work
        git(work, "checkout", "-q", "main")
        _, data = self.api("GET", "repos/%s/branches" % self.rid())
        self.assertEqual([b["name"] for b in data["local"] if b["current"]], ["main"])
        self.assertTrue(any(b["name"] == "origin/develop" for b in data["remote"]))
        self.assertNotIn("origin/HEAD", [b["name"] for b in data["remote"]])
        # switch: a local branch, then a branch that only the remote has
        git(work, "branch", "local-one", "develop")
        self.assertEqual(self.run_job("switch", {"name": "local-one"})["state"], "done")
        self.assertEqual(git(work, "branch", "--show-current"), "local-one")
        git(self.world.remote, "branch", "only-remote", "develop")
        git(work, "fetch", "-q", "origin")
        self.assertEqual(self.run_job("switch", {"name": "origin/only-remote"})["state"], "done")
        self.assertEqual(git(work, "branch", "--show-current"), "only-remote")
        self.assertEqual(self.run_job("switch", {"name": "nowhere"})["state"], "failed")
        # a branch at a commit
        tip = git(work, "rev-parse", "main")
        self.assertEqual(self.run_job("branch", {"name": "from/main", "commit": tip})["state"], "done")
        self.assertEqual(git(work, "rev-parse", "HEAD"), tip)
        # a cherry-pick of a commit from another branch onto a feature branch
        self.world.feature("feat/cp-src", {"cp/src.txt": "src\n"})
        git(work, "add", "-A"); git(work, "commit", "-q", "-m", "to pick")
        picked = git(work, "rev-parse", "HEAD")
        git(work, "checkout", "-q", "-b", "feat/cp-dst", "develop")
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "cherry-pick", "params": {"commits": [picked]}})
        self.assertTrue(data["ok"], data)
        self.assertEqual(git(work, "log", "-1", "--format=%s"), "develop start", "a preview picks nothing")
        self.assertEqual(self.run_job("cherry-pick", {"commits": [picked]})["state"], "done")
        self.assertEqual(git(work, "log", "-1", "--format=%s"), "to pick")
        # not onto a protected branch
        git(work, "checkout", "-q", "develop")
        self.assertEqual(self.run_job("cherry-pick", {"commits": [picked]})["state"], "failed")
        git(work, "checkout", "-q", "main")

    def test_the_graph_can_hide_branches(self):
        work = self.world.work
        git(work, "checkout", "-q", "main")
        git(work, "branch", "hidden-one", "develop")
        everything = self.api("POST", "repos/%s/graph" % self.rid(), {})[1]
        names = lambda d: {r for c in d["commits"] for r in c["refs"]}
        self.assertTrue(any("hidden-one" in r for r in names(everything)))
        shown = self.api("POST", "repos/%s/graph" % self.rid(), {"refs": ["refs/heads/main"]})[1]
        self.assertFalse(any("hidden-one" in r for r in names(shown)), "a hidden branch is not drawn")
        self.assertTrue(any(r.startswith("HEAD -> ") for r in names(shown)), "where you are is always shown")
        for bad in (["--all"], ["refs/heads/../x"], ["main"], "refs/heads/main", [5], ["refs/heads/a b"]):
            self.assertEqual(self.api("POST", "repos/%s/graph" % self.rid(), {"refs": bad})[0], 400, bad)
        git(work, "branch", "-D", "hidden-one")

    def test_preview_changes_nothing_and_shows_the_commands(self):
        self.world.feature("feat/preview", {"pv_a/a.py": "a\n", "pv_b/b.py": "b\n"})
        git(self.world.work, "add", "-A")
        head = git(self.world.work, "rev-parse", "HEAD")
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "ship", "params": {"commits": [
            {"message": "[FEAT] pv_a: first", "paths": ["pv_a"]}, {"message": "[FEAT] pv_b: second", "paths": ["pv_b"]}]}})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["ok"], data)
        self.assertEqual(len(data["steps"]), 3, "two commits and the ship")
        self.assertIn("git commit", data["steps"][0]["output"])
        self.assertIn("git merge --no-ff", data["steps"][2]["output"])
        self.assertEqual(head, git(self.world.work, "rev-parse", "HEAD"), "a preview commits nothing")
        self.assertNotIn("feat/preview", self.world.remote_log("develop")[0])
        git(self.world.work, "reset", "-q", "--hard"); git(self.world.work, "clean", "-fdq"); git(self.world.work, "checkout", "-q", "main")

    def test_preview_reports_a_refusal(self):
        self.world.feature("feat/refused", {"rf_a/a.py": "a\n"})
        git(self.world.work, "add", "-A")
        git(self.world.work, "config", "shuttle.messagePattern", r"^\[[A-Z]+\] [^:]+: .+")
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "ship", "params": {"commits": [{"message": "no tag", "paths": ["rf_a"]}]}})
        git(self.world.work, "config", "--unset", "shuttle.messagePattern")
        self.assertEqual(status, 200)
        self.assertFalse(data["ok"])
        self.assertIn("shuttle.messagePattern", data["steps"][-1]["output"])
        git(self.world.work, "reset", "-q", "--hard"); git(self.world.work, "clean", "-fdq"); git(self.world.work, "checkout", "-q", "main")

    def test_ship_two_commits_by_module(self):
        self.world.feature("feat/two", {"tw_a/a.py": "a\n", "tw_b/b.py": "b\n"})
        git(self.world.work, "add", "-A")
        job = self.run_job("ship", {"commits": [{"message": "[FEAT] tw_a: first", "paths": ["tw_a"]},
                                                {"message": "[FEAT] tw_b: second", "paths": ["tw_b"]}]})
        self.assertEqual(job["state"], "done", job)
        self.assertEqual([s["state"] for s in job["steps"]], ["done", "done", "done"])
        log = self.world.remote_log("develop")
        self.assertEqual(log[0], "Merge branch 'feat/two' into develop")
        self.assertIn("[FEAT] tw_a: first", log); self.assertIn("[FEAT] tw_b: second", log)
        self.assertEqual(git(self.world.work, "branch", "--show-current"), "feat/two")
        self.assertTrue(any(h["action"] == "ship" and h["state"] == "done" for h in self.api("GET", "history")[1]["history"]))

    def test_ship_stops_at_the_first_failure(self):
        self.world.feature("feat/stops", {"st_a/a.py": "a\n"})
        git(self.world.work, "add", "-A")
        job = self.run_job("ship", {"commits": [{"message": "[FEAT] st_a: ok", "paths": ["st_a"]},
                                                {"message": "[FEAT] mod_z: nothing here", "paths": ["mod_z"]}]})
        self.assertEqual(job["state"], "failed", job)
        self.assertEqual([s["state"] for s in job["steps"]], ["done", "stopped", "todo"])
        self.assertNotIn("feat/stops", " ".join(self.world.remote_log("develop")[:1]))

    def test_ship_with_a_pull_request(self):
        self.world.feature("feat/prr", {"pr_a/a.py": "a\n"})
        git(self.world.work, "add", "-A")
        job = self.run_job("ship", {"commits": [{"message": "[IMP] pr_a: through a PR", "paths": ["pr_a"]}], "pr": True, "title": "A title", "body": "the body"})
        self.assertEqual(job["state"], "done", job)
        with open(self.world.gh_log) as f:
            self.assertIn("pr create --base develop --head feat/prr --title A title --body the body", f.read())
        self.assertIn("[IMP] pr_a: through a PR", self.world.remote_log("feat/prr"))
        self.assertNotIn("Merge branch 'feat/prr' into develop", self.world.remote_log("develop"))

    def test_a_conflict_stops_and_can_be_aborted_or_continued(self):
        for token in ("abort", "continue"):
            git(self.world.work, "checkout", "-q", "-b", "feat/cf_" + token, "develop")
            write(os.path.join(self.world.work, "clash.txt"), "mine %s\n" % token)
            git(self.world.work, "add", "-A"); git(self.world.work, "commit", "-q", "-m", "mine")
            other = os.path.join(self.world.root, "other"); shutil.rmtree(other, ignore_errors=True)
            git(self.world.root, "clone", "-q", self.world.remote, other)
            git(other, "checkout", "-q", "develop"); write(os.path.join(other, "clash.txt"), "theirs %s\n" % token)
            git(other, "add", "-A"); git(other, "commit", "-q", "-m", "theirs " + token); git(other, "push", "-q", "origin", "develop")
            job = self.run_job("ship", {})
            self.assertEqual(job["state"], "stopped", job)
            self.assertEqual(job["exit"], 2)
            status = self.api("GET", "repos/%s/status" % self.rid())[1]["status"]
            self.assertEqual(status["operation"], "rebase")
            self.assertEqual(status["conflict"], ["clash.txt"])
            self.assertTrue(any("waiting" in b for b in status["blocker"]))
            # nothing else may start while it waits
            again = self.run_job("sync")
            self.assertNotEqual(again["state"], "done")
            if token == "abort":
                self.assertEqual(self.run_job("abort")["state"], "done")
            else:
                write(os.path.join(self.world.work, "clash.txt"), "resolved\n")
                self.assertEqual(self.run_job("continue")["state"], "done")
            status = self.api("GET", "repos/%s/status" % self.rid())[1]["status"]
            self.assertEqual(status["operation"], "")
            git(self.world.work, "checkout", "-q", "main")

    def test_release_from_candidates(self):
        self.world.feature("feat/rel1", {"r1.txt": "1\n"})
        git(self.world.work, "add", "-A"); git(self.world.work, "commit", "-q", "-m", "[FEAT] r: one")
        self.assertEqual(self.run_job("ship", {})["state"], "done")
        git(self.world.work, "checkout", "-q", "main")
        self.api("POST", "repos/%s/fetch" % self.rid(), {})
        status, data = self.api("GET", "repos/%s/candidates" % self.rid())
        self.assertEqual(status, 200)
        mine = [c for c in data["candidates"] if "feat/rel1" in c["subject"]][0]
        self.assertEqual([c["subject"] for c in mine["commits"]], ["[FEAT] r: one"])
        self.assertTrue(mine["commits"][0]["pending"])
        git(self.world.work, "config", "shuttle.releasePattern", "rel-{date}-v1.{n}")
        job = self.run_job("release", {"onto": "auto", "commits": [mine["commits"][0]["hash"]], "push": True})
        git(self.world.work, "config", "--unset", "shuttle.releasePattern")
        self.assertEqual(job["state"], "done", job)
        names = git(self.world.work, "branch", "--list", "rel-*").split()
        self.assertTrue(any(n.endswith("-v1.0") for n in names), names)
        self.assertTrue(any("rel-" in b for b in git(self.world.remote, "branch").split()))
        git(self.world.work, "checkout", "-q", "main")

    def test_init_sets_the_configuration(self):
        job = self.run_job("init", {"integration": "develop", "release": "release", "messagePattern": r"^\[[A-Z]+\] .+",
                                    "forbidTrailers": "Co-Authored-By", "branchPrefix": "x-feature/", "upgradeCommand": "echo {modules}"})
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(git(self.world.work, "config", "shuttle.branchPrefix"), "x-feature/")
        self.assertEqual(git(self.world.work, "config", "shuttle.upgradeCommand"), "echo {modules}")
        self.assertEqual(git(self.world.work, "config", "shuttle.forbidTrailers"), "Co-Authored-By")
        git(self.world.work, "config", "--unset", "shuttle.branchPrefix"); git(self.world.work, "config", "--unset", "shuttle.upgradeCommand")
        git(self.world.work, "config", "--unset", "shuttle.messagePattern"); git(self.world.work, "config", "--unset", "shuttle.forbidTrailers")

    def test_only_one_job_per_repository(self):
        hook = os.path.join(self.world.remote, "hooks", "pre-receive")
        write(hook, "#!/bin/sh\nsleep 2\nexit 0\n"); os.chmod(hook, 0o755)
        try:
            self.world.feature("feat/slow", {"sl_a/slow.txt": "s\n"})
            git(self.world.work, "add", "-A")
            first = self.api("POST", "repos/%s/run" % self.rid(), {"action": "ship", "params": {"commits": [{"message": "[FIX] sl_a: slow", "paths": ["sl_a"]}]}})
            self.assertEqual(first[0], 200)
            second = self.api("POST", "repos/%s/run" % self.rid(), {"action": "sync", "params": {}})
            self.assertEqual(second[0], 409, "a second action while one runs")
            deadline = time.time() + 60
            while time.time() < deadline and self.api("GET", "jobs/" + first[1]["job"])[1]["job"]["state"] == "running":
                time.sleep(0.2)
            self.assertEqual(self.api("POST", "repos/%s/run" % self.rid(), {"action": "sync", "params": {}})[0], 200, "free again afterwards")
        finally:
            os.remove(hook)
            time.sleep(0.5)


class TestRename(Base):
    def names(self):
        return {r["id"]: r["name"] for r in self.api("GET", "repos")[1]["repos"]}

    def test_a_repository_can_be_renamed_and_the_name_is_kept(self):
        status, data = self.api("POST", "repos/%s/rename" % self.rid(), {"name": "  Customer site  "})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["repo"]["name"], "Customer site", "the name is trimmed")
        self.assertEqual(self.names()[self.rid()], "Customer site")
        saved = json.load(open(self.store.repos_file))
        self.assertEqual([r["name"] for r in saved if r["id"] == self.rid()], ["Customer site"], "kept on disk")
        self.assertEqual(oct(os.stat(self.store.repos_file).st_mode & 0o777), "0o600", "still private")
        self.api("POST", "repos/%s/rename" % self.rid(), {"name": os.path.basename(self.world.work)})

    def test_the_history_uses_the_display_name(self):
        self.api("POST", "repos/%s/rename" % self.rid(), {"name": "Shown name"})
        self.run_job("sync")   # on the protected main it is refused, and the history says for which repository
        self.assertEqual(self.api("GET", "history")[1]["history"][0]["repo"], "Shown name")
        self.api("POST", "repos/%s/rename" % self.rid(), {"name": os.path.basename(self.world.work)})

    def test_invalid_names_are_refused(self):
        for bad in ("", "   ", "x" * 81, "two\nlines", "tab\there", "nul\0", None, 5, ["a"], {"a": 1}):
            status, _ = self.api("POST", "repos/%s/rename" % self.rid(), {"name": bad})
            self.assertEqual(status, 400, repr(bad))
        self.assertEqual(self.api("POST", "repos/%s/rename" % self.rid(), {})[0], 400, "no name")
        self.assertEqual(self.api("POST", "repos/%s/rename" % self.rid(), {"name": "x" * 80})[0], 200, "80 characters are fine")
        self.api("POST", "repos/%s/rename" % self.rid(), {"name": os.path.basename(self.world.work)})

    def test_an_unknown_repository_is_a_404(self):
        self.assertEqual(self.api("POST", "repos/nope/rename", {"name": "x"})[0], 404)

    def test_two_repositories_may_share_a_name(self):
        other = tempfile.mkdtemp(prefix="shuttle-ui-twin.")
        try:
            git(other, "init", "-q", "-b", "main")
            second = self.api("POST", "repos", {"path": other, "name": "Twin"})[1]["repo"]
            self.assertEqual(second["name"], "Twin", "a name may be given when adding")
            self.assertEqual(self.api("POST", "repos/%s/rename" % second["id"], {"name": "Twin"})[0], 200)
            self.api("POST", "repos/%s/rename" % self.rid(), {"name": "Twin"})
            self.assertEqual(sorted(n for n in self.names().values() if n == "Twin"), ["Twin", "Twin"])
            self.assertEqual(self.api("POST", "repos", {"path": other, "name": "x\ny"})[0], 400, "a bad name is refused when adding")
        finally:
            self.api("POST", "repos/%s/rename" % self.rid(), {"name": os.path.basename(self.world.work)})
            for r in self.api("GET", "repos")[1]["repos"]:
                if r["path"] == os.path.realpath(other):
                    self.api("POST", "repos/%s/remove" % r["id"], {})
            shutil.rmtree(other, ignore_errors=True)


class TestBrowse(Base):
    """Commit details, the diff of a file and the working tree: read only, against a repository made for the purpose."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.lab = tempfile.mkdtemp(prefix="shuttle-ui-lab.")
        w = cls.lab
        git(w, "init", "-q", "-b", "main")
        write(os.path.join(w, "plain.txt"), "one\ntwo\nthree\n")
        write(os.path.join(w, 'we ird "q" ünï.txt'), "a\nb\nc\n")
        write(os.path.join(w, "dir", "sub.txt"), "sub\n")
        with open(os.path.join(w, "bin.dat"), "wb") as f:
            f.write(b"\0\1\2binary\0")
        git(w, "add", "-A"); git(w, "commit", "-q", "-m", "root commit\n\nwith a body")
        cls.root = git(w, "rev-parse", "HEAD")
        write(os.path.join(w, "plain.txt"), "one\nTWO\nthree\nfour\n")
        git(w, "mv", 'we ird "q" ünï.txt', "renamed é.txt")
        with open(os.path.join(w, "renamed é.txt"), "a") as f:
            f.write("d\n")
        with open(os.path.join(w, "bin.dat"), "wb") as f:
            f.write(b"\0\1\2other\0")
        git(w, "add", "-A"); git(w, "commit", "-q", "-m", "change, rename, binary")
        cls.change = git(w, "rev-parse", "HEAD")
        git(w, "commit", "-q", "--allow-empty", "-m", "empty commit")
        cls.empty = git(w, "rev-parse", "HEAD")
        git(w, "checkout", "-q", "-b", "side", cls.change)
        write(os.path.join(w, "side.txt"), "side\n"); git(w, "add", "-A"); git(w, "commit", "-q", "-m", "side work")
        git(w, "checkout", "-q", "main")
        write(os.path.join(w, "main.txt"), "main\n"); git(w, "add", "-A"); git(w, "commit", "-q", "-m", "main work")
        git(w, "merge", "-q", "--no-ff", "-m", "merge side", "side")
        cls.merge = git(w, "rev-parse", "HEAD")
        write(os.path.join(w, "long.txt"), "".join("line %d\n" % i for i in range(6000)))
        write(os.path.join(w, "wide.txt"), "".join("x" * 60 + "\n" for _ in range(8000)))
        git(w, "add", "-A"); git(w, "commit", "-q", "-m", "big files")
        cls.big = git(w, "rev-parse", "HEAD")
        # the working tree: staged, unstaged, untracked
        write(os.path.join(w, "staged.txt"), "staged\n"); git(w, "add", "staged.txt")
        write(os.path.join(w, "plain.txt"), "one\nTWO\nthree\nfour\nfive\n")
        write(os.path.join(w, "new file ü.txt"), "new\nlines\n")
        with open(os.path.join(w, "new.bin"), "wb") as f:
            f.write(b"\0\0\0")
        os.symlink("plain.txt", os.path.join(w, "link"))
        write(os.path.join(w, "huge.txt"), "y" * (1300 * 1024))
        cls.lab_repo = cls.store.add_repo(os.path.realpath(w), "lab")
        cls.empty_repo_dir = tempfile.mkdtemp(prefix="shuttle-ui-nocommit.")
        git(cls.empty_repo_dir, "init", "-q", "-b", "main")
        cls.empty_repo = cls.store.add_repo(os.path.realpath(cls.empty_repo_dir), "nocommit")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.lab, ignore_errors=True)
        shutil.rmtree(cls.empty_repo_dir, ignore_errors=True)
        super().tearDownClass()

    def commit(self, sha, repo=None):
        return self.api("GET", "repos/%s/commits/%s" % ((repo or self.lab_repo)["id"], sha))

    def diff(self, source, path, repo=None, **extra):
        return self.api("POST", "repos/%s/diff" % (repo or self.lab_repo)["id"], {"source": source, "path": path, **extra})

    def files(self, data):
        return {f["path"]: f for f in data["files"]}

    # -- a commit
    def test_a_root_commit_shows_everything_as_added(self):
        status, d = self.commit(self.root)
        self.assertEqual(status, 200, d)
        self.assertEqual((d["sha"], d["parents"], d["merge"]), (self.root, [], False))
        self.assertEqual(d["message"], "root commit\n\nwith a body")
        self.assertEqual({f["status"] for f in d["files"]}, {"A"})
        self.assertEqual(sorted(self.files(d)), sorted(["plain.txt", 'we ird "q" ünï.txt', "dir/sub.txt", "bin.dat"]))
        self.assertEqual(set(d), {"sha", "parents", "author", "email", "time", "committer", "committer_email", "committer_time", "refs", "message", "merge", "files", "files_truncated"})
        self.assertEqual((d["author"], d["email"]), ("Tester", "tester@example.com"))

    def test_a_short_id_is_accepted(self):
        self.assertEqual(self.commit(self.root[:8])[1]["sha"], self.root)

    def test_a_rename_a_change_and_a_binary_file(self):
        d = self.commit(self.change)[1]
        f = self.files(d)
        self.assertEqual(f["renamed é.txt"]["status"], "R")
        self.assertEqual(f["renamed é.txt"]["old_path"], 'we ird "q" ünï.txt')
        self.assertEqual((f["renamed é.txt"]["additions"], f["renamed é.txt"]["deletions"]), (1, 0))
        self.assertEqual(f["plain.txt"]["status"], "M")
        self.assertEqual((f["plain.txt"]["additions"], f["plain.txt"]["deletions"]), (2, 1))
        self.assertTrue(f["bin.dat"]["binary"])
        self.assertIsNone(f["bin.dat"]["additions"])
        self.assertFalse(f["plain.txt"]["binary"])

    def test_an_empty_commit_has_no_files(self):
        d = self.commit(self.empty)[1]
        self.assertEqual(d["files"], [])
        self.assertEqual(d["message"], "empty commit")

    def test_a_merge_is_shown_against_its_first_parent(self):
        d = self.commit(self.merge)[1]
        self.assertTrue(d["merge"])
        self.assertEqual(len(d["parents"]), 2)
        self.assertEqual(sorted(self.files(d)), ["side.txt"], "what the merge brought onto the first parent")
        self.assertEqual(self.diff(self.merge, "side.txt")[1]["text"].count("+side"), 1)

    def test_refs_of_a_commit(self):
        self.assertTrue(any(r.startswith("HEAD -> ") for r in self.commit(self.big)[1]["refs"]))

    def test_bad_commit_ids(self):
        for bad in ("zzzzzzz", "abc", "-x", "--all", "HEAD", "main", "a" * 41, "../x", "%2e%2e", "deadbeef" * 5):
            self.assertIn(self.commit(bad)[0], (400, 404), bad)
        self.assertEqual(self.commit("deadbeef")[0], 404, "a well-formed id that is not here")
        self.assertEqual(self.commit("zzzzzzz")[0], 400)
        self.assertEqual(self.commit("--all")[0], 400)

    def test_a_commit_of_another_repository_is_not_found(self):
        self.assertEqual(self.commit(self.root, self.empty_repo)[0], 404)

    def test_unknown_repository(self):
        self.assertEqual(self.api("GET", "repos/nope/commits/" + self.root)[0], 404)
        self.assertEqual(self.api("GET", "repos/nope/worktree")[0], 404)
        self.assertEqual(self.api("POST", "repos/nope/diff", {"source": "worktree", "path": "a"})[0], 404)

    def test_a_repository_without_commits(self):
        self.assertEqual(self.commit("deadbeef", self.empty_repo)[0], 404)
        status, d = self.api("GET", "repos/%s/worktree" % self.empty_repo["id"])
        self.assertEqual((status, d["staged"], d["unstaged"], d["untracked"]), (200, [], [], []))

    # -- a file's diff
    def test_the_diff_of_a_file_in_a_commit(self):
        status, d = self.diff(self.change, "plain.txt")
        self.assertEqual(status, 200, d)
        self.assertIn("@@ -1,3 +1,4 @@", d["text"])
        self.assertIn("-two\n+TWO", d["text"])
        self.assertEqual((d["truncated"], d["binary"]), (False, False))
        self.assertNotIn(self.change, d["text"].splitlines()[0], "no commit id line in front of the diff")

    def test_a_root_commit_diff_and_odd_file_names(self):
        d = self.diff(self.root, 'we ird "q" ünï.txt')[1]
        self.assertIn("+a\n+b\n+c", d["text"])
        self.assertTrue(d["text"].startswith("diff --git"))

    def test_a_rename_keeps_its_history_when_the_old_name_is_given(self):
        d = self.diff(self.change, "renamed é.txt", old_path='we ird "q" ünï.txt')[1]
        self.assertIn("rename from", d["text"])
        self.assertIn("+d", d["text"])
        alone = self.diff(self.change, "renamed é.txt")[1]
        self.assertIn("new file", alone["text"], "without the old name it is only an addition")

    def test_a_binary_file_has_no_text(self):
        d = self.diff(self.change, "bin.dat")[1]
        self.assertEqual((d["binary"], d["text"]), (True, ""))

    def test_a_long_diff_is_cut_by_lines_and_says_so(self):
        d = self.diff(self.big, "long.txt")[1]
        self.assertTrue(d["truncated"])
        self.assertLessEqual(d["text"].count("\n"), 5000)
        self.assertTrue(d["text"].endswith("\n"))

    def test_a_heavy_diff_is_cut_by_size_and_never_in_the_middle_of_a_line(self):
        d = self.diff(self.big, "wide.txt")[1]
        self.assertTrue(d["truncated"])
        self.assertLessEqual(len(d["text"].encode()), 300 * 1024)
        self.assertTrue(d["text"].endswith("\n"))
        self.assertTrue(all(line.startswith(("+", "diff", "new", "index", "---", "@@")) for line in d["text"].splitlines()))

    def test_context_lines(self):
        wide = self.diff(self.change, "plain.txt", context=10)[1]["text"]
        none = self.diff(self.change, "plain.txt", context=0)[1]["text"]
        self.assertIn("\n one\n", wide)
        self.assertNotIn("\n one\n", none)
        for bad in (-1, 1001, "3", True, 2.5, [3]):
            self.assertEqual(self.diff(self.change, "plain.txt", context=bad)[0], 400, repr(bad))

    def test_the_diff_refuses_what_is_not_a_commit_or_a_path_of_the_repository(self):
        for source in ("HEAD", "--all", "main", "../x", "", None, 5, "zzzzzzz"):
            self.assertIn(self.diff(source, "plain.txt")[0], (400, 404), repr(source))
        for path in ("../etc/passwd", "/etc/passwd", "-p", "--output=/tmp/x", "a/../../b", "", None, 5, "a\0b"):
            self.assertEqual(self.diff("worktree", path)[0], 400, repr(path))
            self.assertEqual(self.diff("untracked", path)[0], 400, repr(path))
            self.assertEqual(self.diff(self.change, path)[0], 400, repr(path))
        self.assertEqual(self.diff("worktree", "plain.txt", old_path="../x")[0], 400)

    def test_the_diff_needs_the_token_and_json(self):
        self.assertEqual(self.request("GET", "/api/repos/%s/commits/%s" % (self.lab_repo["id"], self.root), token=False)[0], 401)
        self.assertEqual(self.request("GET", "/api/repos/%s/worktree" % self.lab_repo["id"], token=False)[0], 401)
        self.assertEqual(self.request("POST", "/api/repos/%s/diff" % self.lab_repo["id"], raw=b"source=worktree&path=a")[0], 415)

    # -- the working tree
    def test_the_working_tree_is_grouped(self):
        status, d = self.api("GET", "repos/%s/worktree" % self.lab_repo["id"])
        self.assertEqual(status, 200, d)
        self.assertEqual([f["path"] for f in d["staged"]], ["staged.txt"])
        self.assertEqual(d["staged"][0]["status"], "A")
        self.assertEqual([f["path"] for f in d["unstaged"]], ["plain.txt"])
        self.assertEqual(d["unstaged"][0]["status"], "M")
        self.assertEqual((d["unstaged"][0]["additions"], d["unstaged"][0]["deletions"]), (1, 0))
        self.assertEqual(sorted(f["path"] for f in d["untracked"]), ["huge.txt", "link", "new file ü.txt", "new.bin"])
        self.assertTrue(all(f["status"] == "?" for f in d["untracked"]))

    def test_the_diff_of_the_working_tree(self):
        self.assertIn("+five", self.diff("worktree", "plain.txt")[1]["text"])
        self.assertIn("+staged", self.diff("staged", "staged.txt")[1]["text"])
        self.assertEqual(self.diff("worktree", "staged.txt")[1]["text"], "", "a staged file has nothing unstaged")

    def test_the_diff_of_an_untracked_file(self):
        d = self.diff("untracked", "new file ü.txt")[1]
        self.assertIn("+new\n+lines", d["text"])
        self.assertIn("new file", d["text"])
        self.assertEqual(self.diff("untracked", "new.bin")[1]["binary"], True)

    def test_an_untracked_symlink_a_huge_file_and_a_missing_file(self):
        link = self.diff("untracked", "link")[1]
        self.assertEqual((link["text"], link["binary"]), ("", False))
        self.assertIn("symbolic link", link["note"])
        huge = self.diff("untracked", "huge.txt")[1]
        self.assertTrue(huge["truncated"])
        self.assertEqual(huge["text"], "")
        self.assertIn("too large", huge["note"])
        self.assertEqual(self.diff("untracked", "missing.txt")[0], 404)
        self.assertEqual(self.diff("untracked", "dir")[0], 404, "a folder is not a file")

    def test_an_untracked_link_to_outside_is_not_followed(self):
        outside = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt")
        outside.write("secret\n"); outside.close()
        link = os.path.join(self.lab, "escape")
        os.symlink(outside.name, link)
        try:
            d = self.diff("untracked", "escape")[1]
            self.assertNotIn("secret", d["text"])
            self.assertIn("symbolic link", d["note"])
        finally:
            os.remove(link); os.remove(outside.name)

    def test_nothing_is_changed_by_looking(self):
        before = git(self.lab, "status", "--porcelain=v1", "-uall") + git(self.lab, "rev-parse", "HEAD") + git(self.lab, "stash", "list")
        for source in (self.root, self.merge, "worktree", "staged", "untracked"):
            self.diff(source, "plain.txt")
        self.commit(self.merge); self.api("GET", "repos/%s/worktree" % self.lab_repo["id"])
        after = git(self.lab, "status", "--porcelain=v1", "-uall") + git(self.lab, "rev-parse", "HEAD") + git(self.lab, "stash", "list")
        self.assertEqual(before, after)

    def test_a_diff_never_runs_an_external_program(self):
        marker = os.path.join(self.lab, ".git", "ran")
        git(self.lab, "config", "diff.external", "sh -c 'touch %s'" % marker)
        git(self.lab, "config", "diff.textconv", "sh -c 'touch %s; cat'" % marker)
        try:
            self.diff("worktree", "plain.txt"); self.diff(self.change, "plain.txt"); self.api("GET", "repos/%s/worktree" % self.lab_repo["id"])
            self.assertFalse(os.path.exists(marker))
        finally:
            git(self.lab, "config", "--unset", "diff.external"); git(self.lab, "config", "--unset", "diff.textconv")


if __name__ == "__main__":
    unittest.main(verbosity=2)
