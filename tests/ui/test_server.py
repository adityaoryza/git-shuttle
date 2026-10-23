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
os.environ.setdefault("GIT_SHUTTLE_NO_UPDATE_CHECK", "1")   # a command looks for a newer release by itself (update_remind): not in a test
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui"))
from shuttle_ui import cli, http as ui_http, updates  # noqa: E402
import shuttle_ui as ui_version  # noqa: E402
from shuttle_ui.errors import BadRequest  # noqa: E402
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
        for bad in ("../cli.py", "%2e%2e/cli.py", "..%2fcli.py", "js/../../cli.py", "js/../../__init__.py", "vendor/README.md", "js", "js/", "", "nothing.js", "%2e%2e%2f%2e%2e%2fbin/git-shuttle", "js/package.json", "/etc/passwd", "//etc/passwd"):
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

    def test_a_page_that_went_away_before_the_answer_is_not_an_error(self):
        """A closed or reloaded tab made a BrokenPipeError, then a second one while the 500 was sent: a traceback in the window of the server."""
        import types
        for error in (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            def refuse(*a, _error=error, **k):
                raise _error()
            fake = types.SimpleNamespace(send_response=lambda *a: None, send_header=lambda *a: None, end_headers=refuse,
                                         wfile=types.SimpleNamespace(write=refuse), close_connection=False, status=None)
            ui_http.Handler._send(fake, 200, {"ok": True})        # must not raise
            self.assertTrue(fake.close_connection, "the connection is dropped, not reused")
            self.assertEqual(fake.status, 200)

    def test_a_missing_route_answers_exactly_not_found_so_that_the_page_can_tell_an_old_server(self):
        status, data = self.api("GET", "no/such/route")
        self.assertEqual((status, data), (404, {"error": "not found"}))
        self.assertEqual(self.api("GET", "repos/nope/status")[1], {"error": "unknown repository"}, "a real 404 says something else")

    def test_the_graph_lists_commits_with_parents_and_refs(self):
        status, data = self.api("GET", "repos/%s/graph" % self.rid())
        self.assertEqual(status, 200, data)
        self.assertGreaterEqual(len(data["commits"]), 1)
        first = data["commits"][0]
        self.assertEqual(set(first), {"sha", "parents", "author", "email", "time", "committer", "committer_email", "committer_time", "refs", "subject", "body"})
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

    def test_a_refused_request_does_not_leave_its_body_for_the_next_one(self):
        """On a kept-alive connection the body of a refused POST would be read as the start of the next request."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        host = {"Host": "127.0.0.1:%d" % self.port, "Content-Type": "application/json"}
        body = json.dumps({"path": "/tmp", "padding": "x" * 5000})
        conn.request("POST", "/api/repos", body=body, headers=host)           # no token: 401, body not needed
        first = conn.getresponse(); first.read()
        self.assertEqual(first.status, 401)
        conn.request("GET", "/api/version", headers=dict(host, **{"X-Shuttle-Token": "test-token-123"}))
        second = conn.getresponse(); second.read()
        self.assertEqual(second.status, 200, "the same connection still answers the next request")
        conn.close()

    def test_a_refused_body_never_resets_the_connection(self):
        for _ in range(40):
            status, _, _, _ = self.request("POST", "/api/repos", raw=b'{"path": "/tmp", "x": "%s"}' % (b"y" * 4000), headers={"Content-Type": "text/plain"})
            self.assertEqual(status, 415)

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
            ("release", {"onto": "ok", "empty": True, "commits": ["abcdef1"]}),
            ("release", {"onto": "ok", "empty": True, "append": True}),
            ("release", {"onto": "auto", "append": True, "commits": ["abcdef1"]}),
            ("release", {"onto": "ok", "append": True, "commits": []}),
            ("release", {"onto": "ok", "commits": "abcdef1"}),
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
            ("start", {"name": "x", "stash": True, "carry": True}),
            ("unstage", {"paths": []}),
            ("unstage", {"paths": "a.txt"}),
            ("unstage", {"paths": ["--all"]}),
            ("unstage", {"paths": ["../x"]}),
            ("discard", {"paths": []}),
            ("discard", {"paths": ["/etc/passwd"]}),
            ("discard", {"paths": ["a.txt"], "staged": "yes"}),
            ("discard", {"paths": ["a.txt"], "untracked": 5}),
            ("stage", {"paths": ["a"] * 2001}),
            ("switch", {"name": "-x"}),
            ("switch", {"name": "a b"}),
            ("switch", {}),
            ("branch", {"name": "ok", "commit": "--all"}),
            ("branch", {"name": "ok", "commit": 5}),
            ("branch", {"name": "x;y"}),
            ("branch", {"name": "-x", "push": True}),
            ("branch", {"name": "ok", "commit": "--all", "push": True}),
            ("push", {"force": "yes please"}),
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

    def own_world(self):
        """Repositories for one test only; the fake gh of the shared world stays the one in use afterwards."""
        gh = os.environ.get("GIT_SHUTTLE_GH")
        world = World()
        def restore():
            world.close()
            os.environ["GIT_SHUTTLE_GH"] = gh
        self.addCleanup(restore)
        return world

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

    def test_fetch_says_what_it_changed(self):
        world = self.own_world()                # its own repositories: this test moves develop on the remote
        work, remote = world.work, world.remote
        route = "repos/%s/fetch" % self.store.add_repo(os.path.realpath(work))["id"]
        status, data = self.api("POST", route, {})
        self.assertEqual((status, data["ok"], data["remote"]), (200, True, "origin"))
        self.assertTrue(data["summary"]["up_to_date"], "nothing changed since the clone")
        self.assertEqual((data["summary"]["new_commits"], data["summary"]["created"], data["summary"]["updated"], data["summary"]["pruned"]), (0, [], [], []))
        # a branch appears on the remote, and develop moves forward there
        git(remote, "branch", "fetch-demo", "develop")
        tip = git(work, "rev-parse", "origin/develop")
        git(work, "checkout", "-q", "develop")
        write(os.path.join(work, "fetched.txt"), "new\n")
        git(work, "add", "fetched.txt"); git(work, "commit", "-q", "-m", "fetched work")
        newest = git(work, "rev-parse", "HEAD")
        git(work, "push", "-q", "origin", "develop")
        git(work, "update-ref", "refs/remotes/origin/develop", tip)       # as if this clone had not seen the push
        git(work, "checkout", "-q", "main")
        summary = self.api("POST", route, {})[1]["summary"]
        self.assertEqual(summary["created"], ["refs/remotes/origin/fetch-demo"])
        self.assertEqual(summary["updated"], ["refs/remotes/origin/develop"])
        self.assertEqual((summary["new_commits"], summary["new_shas"], summary["up_to_date"]), (1, [newest], False))
        # the branch is deleted on the remote: the next fetch prunes it here
        git(remote, "branch", "-D", "fetch-demo")
        summary = self.api("POST", route, {})[1]["summary"]
        self.assertEqual((summary["pruned"], summary["created"], summary["updated"]), (["refs/remotes/origin/fetch-demo"], [], []))
        self.assertEqual(git(work, "branch", "-r", "--list", "origin/fetch-demo"), "")

    def test_a_failed_fetch_has_no_summary(self):
        world = self.own_world()
        git(world.work, "remote", "add", "broken", "/nonexistent/remote.git")
        git(world.work, "config", "shuttle.remote", "broken")
        data = self.api("POST", "repos/%s/fetch" % self.store.add_repo(os.path.realpath(world.work))["id"], {})[1]
        self.assertEqual((data["ok"], data["summary"]), (False, None))
        self.assertTrue(data["output"])

    def test_start_can_stash_or_carry_uncommitted_changes(self):
        work = self.world.work
        git(work, "checkout", "-q", "-b", "feature/busy", "develop")
        for params, stashed in (({"stash": True}, 1), ({"carry": True}, 0)):
            git(work, "checkout", "-q", "feature/busy")
            write(os.path.join(work, "file.txt"), "base\ndev\nuncommitted\n")
            refused = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "start", "params": {"name": "Busy " + str(stashed)}})[1]
            self.assertFalse(refused["ok"], "the default still refuses")
            self.assertIn("uncommitted changes", refused["steps"][0]["output"])
            preview = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "start", "params": {"name": "Busy " + str(stashed), **params}})[1]
            self.assertTrue(preview["ok"], preview)
            job = self.run_job("start", {"name": "Busy " + str(stashed), **params})
            self.assertEqual(job["state"], "done", job)
            self.assertEqual(len(git(work, "stash", "list").splitlines()), stashed)
            git(work, "stash", "drop", check=False); git(work, "checkout", "-q", "--", ".")
        git(work, "checkout", "-q", "main")

    def test_a_branch_made_here_can_be_published_in_the_same_action(self):
        work, remote = self.world.work, self.world.remote
        tip = git(work, "rev-parse", "develop")
        params = {"name": "feature/published-here", "commit": tip, "push": True}
        preview = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "branch", "params": params})[1]
        self.assertTrue(preview["ok"], preview)
        self.assertEqual([s["argv"] for s in preview["steps"]], [["branch", "feature/published-here", tip], ["push"]], "both steps are in the preview")
        self.assertIn("git push -u origin feature/published-here", preview["steps"][1]["output"], "the preview pushes the branch that will exist")
        self.assertEqual(git(work, "branch", "--list", "feature/published-here"), "", "a preview makes nothing")
        job = self.run_job("branch", params)
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(git(remote, "rev-parse", "feature/published-here"), tip, "the branch exists on the remote")
        self.assertEqual(git(work, "rev-parse", "--abbrev-ref", "feature/published-here@{upstream}"), "origin/feature/published-here")
        git(work, "checkout", "-q", "main")
        # without the flag only the branch is made
        plain = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "branch", "params": {"name": "feature/local-only", "commit": tip}})[1]
        self.assertEqual(len(plain["steps"]), 1)

    def test_branches_say_where_they_stand_against_their_upstream(self):
        work = self.world.work
        git(work, "checkout", "-q", "-b", "feature/tracked", "develop")
        git(work, "push", "-q", "-u", "origin", "feature/tracked")
        git(work, "checkout", "-q", "-b", "feature/never-pushed", "develop")
        git(work, "checkout", "-q", "feature/tracked")
        write(os.path.join(work, "t1.txt"), "1\n"); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "ahead 1")
        write(os.path.join(work, "t2.txt"), "2\n"); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "ahead 2")
        git(work, "checkout", "-q", "main")
        by_name = {b["name"]: b for b in self.api("GET", "repos/%s/branches" % self.rid())[1]["local"]}
        self.assertEqual((by_name["feature/tracked"]["upstream"], by_name["feature/tracked"]["ahead"], by_name["feature/tracked"]["behind"]), ("origin/feature/tracked", 2, 0))
        self.assertEqual((by_name["feature/never-pushed"]["upstream"], by_name["feature/never-pushed"]["ahead"]), ("", 0), "no upstream: not pushed")
        # the remote loses the branch: the upstream is gone
        git(self.world.remote, "branch", "-D", "feature/tracked")
        git(work, "fetch", "-q", "--prune", "origin")
        gone = {b["name"]: b for b in self.api("GET", "repos/%s/branches" % self.rid())[1]["local"]}["feature/tracked"]
        self.assertTrue(gone["gone"])

    def test_files_can_be_staged_unstaged_and_discarded(self):
        work = self.world.work
        git(work, "checkout", "-q", "-b", "feature/files-ui", "develop")
        write(os.path.join(work, "a.txt"), "a\n"); write(os.path.join(work, "b.txt"), "b\n")
        git(work, "add", "-A"); git(work, "commit", "-q", "-m", "two files")
        write(os.path.join(work, "a.txt"), "a changed\n"); write(os.path.join(work, "new.txt"), "new\n")
        staged = lambda: git(work, "diff", "--cached", "--name-only").split()
        self.assertEqual(self.run_job("stage", {"paths": ["a.txt", "new.txt"]})["state"], "done")
        self.assertEqual(sorted(staged()), ["a.txt", "new.txt"])
        self.assertEqual(self.run_job("unstage", {"paths": ["a.txt"]})["state"], "done")
        self.assertEqual(staged(), ["new.txt"])
        refused = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "discard", "params": {"paths": ["new.txt"]}})[1]
        self.assertFalse(refused["ok"], "an untracked file is not deleted unless asked")
        self.assertEqual(self.run_job("discard", {"paths": ["a.txt"]})["state"], "done")
        self.assertEqual(open(os.path.join(work, "a.txt")).read(), "a\n")
        self.assertEqual(self.run_job("discard", {"paths": ["new.txt"], "staged": True, "untracked": True})["state"], "done")
        self.assertFalse(os.path.exists(os.path.join(work, "new.txt")))
        git(work, "checkout", "-q", "main")

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
        self.assertTrue(any(h["action"] == "ship" and h["state"] == "done" for h in self.api("GET", "history")[1]["entries"]))

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
        # the release branch is on its way: its commit says where it is, and can no longer be picked
        self.api("POST", "repos/%s/fetch" % self.rid(), {})
        queued = [c for c in self.api("GET", "repos/%s/candidates" % self.rid())[1]["candidates"] if "feat/rel1" in c["subject"]][0]["commits"][0]
        self.assertTrue(queued["in_release"].startswith("rel-") and queued["in_release"].endswith("-v1.0"), queued)
        self.assertFalse(queued["pending"])
        self.assertEqual(mine["commits"][0]["in_release"], "", "a commit that is not in any release branch says nothing")
        git(self.world.work, "config", "--unset", "shuttle.releasePattern")
        self.assertEqual(job["state"], "done", job)
        names = git(self.world.work, "branch", "--list", "rel-*").split()
        self.assertTrue(any(n.endswith("-v1.0") for n in names), names)
        self.assertTrue(any("rel-" in b for b in git(self.world.remote, "branch").split()))
        git(self.world.work, "checkout", "-q", "main")

    def test_an_empty_release_branch_and_commits_added_to_it_later(self):
        work = self.world.work
        git(work, "checkout", "-q", "main")
        job = self.run_job("release", {"onto": "rel-empty", "empty": True, "push": True})
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(git(work, "rev-parse", "rel-empty"), git(work, "rev-parse", "origin/release"), "no commit of its own")
        self.assertIn("rel-empty", git(self.world.remote, "branch").split(), "pushed")
        self.world.feature("feat/rel-later", {"later.txt": "1\n"})
        git(work, "add", "-A"); git(work, "commit", "-q", "-m", "[FEAT] later: one")
        picked = git(work, "rev-parse", "HEAD")
        git(work, "checkout", "-q", "main")
        status, preview = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "release", "params": {"onto": "rel-empty", "append": True, "commits": [picked]}})
        self.assertTrue(preview["ok"], preview)
        self.assertEqual(git(work, "branch", "--show-current"), "main", "a preview moves nothing")
        job = self.run_job("release", {"onto": "rel-empty", "append": True, "commits": [picked]})
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(git(work, "branch", "--show-current"), "rel-empty")
        self.assertEqual(git(work, "log", "-1", "--format=%s"), "[FEAT] later: one")
        git(work, "checkout", "-q", "main")
        self.assertEqual(self.run_job("release", {"onto": "rel-empty", "empty": True})["state"], "failed", "it exists now")

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
        self.assertEqual(self.api("GET", "history")[1]["entries"][0]["repo"], "Shown name")
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


class TestUpdate(Base):
    """GET nothing, POST on request: looking for a release and installing it, against a stand-in for the release pages."""

    def start_release_page(self, version, mode="ok"):
        port_file = os.path.join(self.world.root, "release-port-%d" % time.monotonic_ns())   # one per server: nothing is shared between tests
        helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "helpers", "fake_github.py")
        proc = subprocess.Popen([sys.executable, helper, port_file, version, mode])
        self.addCleanup(proc.wait)
        self.addCleanup(proc.terminate)
        for _ in range(200):     # a loaded machine can take a while to start a process
            if os.path.exists(port_file) and os.path.getsize(port_file):
                break
            time.sleep(0.1)
        self.assertTrue(os.path.exists(port_file), "the stand-in for the release page did not start")
        old = os.environ.get("GIT_SHUTTLE_REPO")
        os.environ["GIT_SHUTTLE_REPO"] = "http://127.0.0.1:%s/acme/git-shuttle" % open(port_file).read()
        self.addCleanup(lambda: os.environ.pop("GIT_SHUTTLE_REPO", None) if old is None else os.environ.update(GIT_SHUTTLE_REPO=old))
        self.addCleanup(lambda: os.remove(port_file) if os.path.exists(port_file) else None)

    def test_the_routes_need_the_token_and_a_post(self):
        for route in ("update/check", "update/apply"):
            self.assertEqual(self.api("POST", route, {}, token=False)[0], 401, route)
            self.assertEqual(self.api("GET", route)[0], 404, route + " is not a GET")

    def test_check_reports_a_newer_release(self):
        self.start_release_page("9.9.9")
        status, data = self.api("POST", "update/check", {})
        self.assertEqual(status, 200, data)
        self.assertEqual((data["latest"], data["available"]), ("9.9.9", True))
        self.assertEqual(data["current"], ui_version.__version__, "the version of the program, as `git shuttle --version` says")
        self.assertEqual(data["kind"], "checkout", "the tests run from a git checkout")
        self.assertFalse(data["can_update"])
        self.assertIn("git pull", data["reason"])
        self.assertTrue(data["notes"].endswith("/releases/tag/v9.9.9"))

    def test_check_when_it_is_the_latest_release(self):
        self.start_release_page(ui_version.__version__)
        data = self.api("POST", "update/check", {})[1]
        self.assertFalse(data["available"])

    def test_check_when_the_release_page_is_not_there(self):
        os.environ["GIT_SHUTTLE_REPO"] = "http://127.0.0.1:9/acme/git-shuttle"
        self.addCleanup(lambda: os.environ.pop("GIT_SHUTTLE_REPO", None))
        status, data = self.api("POST", "update/check", {})
        self.assertEqual(status, 502, data)
        self.assertIn("cannot reach", data["error"])
        self.assertNotIn("error:", data["error"], "the prefix of the command is not shown")

    def test_the_page_cannot_name_where_to_look(self):
        self.start_release_page("9.9.9")
        data = self.api("POST", "update/check", {"repo": "https://evil.example/x/y", "url": "https://evil.example", "to": "v0.0.1"})[1]
        self.assertEqual(data["latest"], "9.9.9", "what the page sends is ignored")

    def test_apply_is_refused_on_a_checkout_and_the_log_says_so(self):
        self.start_release_page("9.9.9")
        before = self.api("GET", "history")[1]["entries"]
        status, data = self.api("POST", "update/apply", {})
        self.assertEqual(status, 500, data)
        self.assertIn("git pull", data["error"])
        entries = self.api("GET", "history")[1]["entries"]
        self.assertEqual(len(entries), len(before) + 1)
        self.assertEqual((entries[0]["action"], entries[0]["state"]), ("update", "failed"))

    def test_one_update_at_a_time(self):
        self.start_release_page("9.9.9")
        self.assertTrue(updates.updates_lock().acquire(blocking=False))
        try:
            status, data = self.api("POST", "update/apply", {})
            self.assertEqual(status, 409, data)
        finally:
            updates.updates_lock().release()


class TestHardening(Base):
    """Things a hostile page, repository or client could try: each one has a test."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.lab = tempfile.mkdtemp(prefix="shuttle-ui-hard.")
        git(cls.lab, "init", "-q", "-b", "main")
        write(os.path.join(cls.lab, "a*.txt"), "star\n")
        write(os.path.join(cls.lab, "ab.txt"), "plain\n")
        write(os.path.join(cls.lab, "x.txt"), "x\n")
        git(cls.lab, "add", "-A"); git(cls.lab, "commit", "-q", "-m", "files")
        cls.repo = cls.store.add_repo(os.path.realpath(cls.lab), "hard")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.lab, ignore_errors=True)
        super().tearDownClass()

    def diff(self, source, path, **extra):
        return self.api("POST", "repos/%s/diff" % self.repo["id"], {"source": source, "path": path, **extra})

    # -- paths are names, never patterns
    def test_a_path_with_glob_characters_names_one_file(self):
        write(os.path.join(self.lab, "a*.txt"), "star changed\n")
        write(os.path.join(self.lab, "ab.txt"), "plain changed\n")
        try:
            status, d = self.diff("worktree", "a*.txt")
            self.assertEqual(status, 200)
            self.assertIn("star changed", d["text"])
            self.assertNotIn("plain changed", d["text"])
        finally:
            git(self.lab, "checkout", "--", ".")

    def test_pathspec_magic_is_not_interpreted(self):
        write(os.path.join(self.lab, "x.txt"), "changed\n")
        try:
            for magic in (":(exclude)ab.txt", ":(top)x.txt", ":/x.txt", ":!ab.txt"):
                status, d = self.diff("worktree", magic)
                self.assertEqual((status, d["text"]), (200, ""), magic)
        finally:
            git(self.lab, "checkout", "--", ".")

    def test_git_is_started_without_variables_that_redirect_it(self):
        from shuttle_ui import runner
        names = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_EXTERNAL_DIFF", "GIT_NAMESPACE")
        old = dict(os.environ)
        os.environ.update({name: "/elsewhere" for name in names})
        try:
            env = runner.child_env()
        finally:
            os.environ.clear(); os.environ.update(old)
        for name in names:
            self.assertNotIn(name, env)
        self.assertEqual(env["GIT_LITERAL_PATHSPECS"], "1")
        self.assertEqual(env["GIT_CONFIG_GLOBAL"], "/dev/null", "settings that isolate git are kept")

    def test_a_repository_cannot_run_its_file_system_monitor_hook(self):
        marker = os.path.join(self.lab, ".git", "monitor-ran")
        git(self.lab, "config", "core.fsmonitor", "touch %s; echo" % marker)
        try:
            subprocess.run(["git", "status"], cwd=self.lab, capture_output=True)
            if not os.path.exists(marker):
                self.skipTest("this git does not run core.fsmonitor like a hook")
            os.remove(marker)
            for route in ("worktree", "branches", "graph"):
                self.api("GET", "repos/%s/%s" % (self.repo["id"], route))
            self.diff("worktree", "x.txt")
            self.assertFalse(os.path.exists(marker))
        finally:
            git(self.lab, "config", "--unset", "core.fsmonitor")

    # -- the remote name comes from the repository's own configuration
    def test_a_remote_name_cannot_be_an_option(self):
        git(self.lab, "config", "shuttle.remote", "-x")
        try:
            status, d = self.api("POST", "repos/%s/fetch" % self.repo["id"], {})
            self.assertEqual(status, 400, d)
        finally:
            git(self.lab, "config", "--unset", "shuttle.remote")

    # -- static files and requests
    def test_a_nul_byte_in_a_static_name_is_a_plain_404(self):
        with self.assertRaises(BadRequest) as caught:
            ui_http.static_file("/static/js/\x00.js")
        self.assertEqual(caught.exception.status, 404)

    def test_nested_brackets_are_a_bad_request_not_a_crash(self):
        raw = ('{"a":' + "[" * 200000 + "]" * 200000 + "}").encode()
        status, data, _, _ = self.request("POST", "/api/repos", raw=raw, headers={"Content-Type": "application/json", "Content-Length": str(len(raw))})
        self.assertEqual(status, 400, data)

    def test_a_refused_body_closes_the_connection(self):
        import socket
        for headers, expected in (("Content-Type: text/plain", b" 415 "), ("Content-Type: application/json\r\nContent-Length: %d" % (ui_http.MAX_BODY + 1), b" 413 ")):
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            sock.sendall(("POST /api/repos HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-Shuttle-Token: test-token-123\r\n%s\r\n" % (self.port, headers)).encode()
                         + (b"Content-Length: 3\r\n\r\nabc" if "Content-Length" not in headers else b"\r\n"))
            sock.settimeout(5)
            reply = b""
            try:
                while True:         # reading to the end only works when the server closes the connection
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    reply += chunk
            except ConnectionResetError:    # closing with the body still unread may reset the connection
                pass
            self.assertIn(expected, reply.split(b"\r\n")[0] + b" ")
            sock.close()

    def test_a_client_that_stops_sending_is_dropped(self):
        import socket
        old, ui_http.Handler.timeout = ui_http.Handler.timeout, 1
        try:
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            sock.sendall(b"GET /api/repos HTTP/1.1\r\nHost: 127")
            time.sleep(1.6)
            sock.settimeout(5)
            self.assertEqual(sock.recv(1), b"")
            sock.close()
        finally:
            ui_http.Handler.timeout = old

    # -- sizes
    def test_a_huge_commit_message_is_cut(self):
        write(os.path.join(self.lab, "m.txt"), "m\n")
        git(self.lab, "add", "m.txt")
        with open(os.path.join(self.lab, ".git", "big-message"), "w") as f:
            f.write("subject\n\n" + "word " * 60000)
        git(self.lab, "commit", "-q", "-F", os.path.join(self.lab, ".git", "big-message"))
        d = self.api("GET", "repos/%s/commits/%s" % (self.repo["id"], git(self.lab, "rev-parse", "HEAD")))[1]
        self.assertLessEqual(len(d["message"]), 100000)
        self.assertTrue(d["message"].startswith("subject"))

    def test_job_output_is_cut(self):
        from shuttle_ui import runner
        cut = runner.limited(b"x" * (runner.MAX_OUTPUT + 500))
        self.assertLess(len(cut), runner.MAX_OUTPUT + 100)
        self.assertIn("output cut", cut)
        self.assertEqual(runner.limited(b"short"), "short")

    def test_old_jobs_are_forgotten(self):
        from shuttle_ui import jobs as jobs_mod
        registry = jobs_mod.Jobs(self.store)
        for i in range(jobs_mod.KEEP_FINISHED + 20):
            registry.jobs["j%d" % i] = {"id": "j%d" % i, "finished": 1000 + i}
        registry.jobs["running"] = {"id": "running", "finished": None}
        registry._forget_old()
        self.assertEqual(len(registry.jobs), jobs_mod.KEEP_FINISHED + 1)
        self.assertIn("running", registry.jobs)
        self.assertIn("j%d" % (jobs_mod.KEEP_FINISHED + 19), registry.jobs)
        self.assertNotIn("j0", registry.jobs)

    def test_the_history_file_is_rotated_and_stays_private(self):
        from shuttle_ui import store as store_mod
        folder = tempfile.mkdtemp(prefix="shuttle-hist.")
        old = store_mod.MAX_HISTORY_BYTES
        store_mod.MAX_HISTORY_BYTES = 3000
        try:
            small = Store(folder)
            for i in range(200):
                small.log({"time": "t", "repo": "r", "action": "a%d" % i, "state": "done", "exit": 0, "commands": []})
            self.assertLess(os.path.getsize(small.history_file), 3000 + 300)
            self.assertTrue(os.path.exists(os.path.join(folder, "history.1.jsonl")), "the old entries are kept once")
            history = small.history()
            self.assertEqual(history[0]["action"], "a199", "the newest entry comes first")
            self.assertEqual([e["id"] for e in history[:3]], [200, 199, 198], "ids keep growing across a rotation")
            for name in ("history.jsonl", "history.1.jsonl"):
                self.assertEqual(oct(os.stat(os.path.join(folder, name)).st_mode & 0o777), "0o600", name)
            self.assertEqual(Store(folder).log({"action": "after restart"})["id"], 201, "a new process goes on from the last id")
        finally:
            store_mod.MAX_HISTORY_BYTES = old
            shutil.rmtree(folder, ignore_errors=True)

    def test_the_settings_folder_is_private(self):
        from shuttle_ui import store as store_mod
        folder = tempfile.mkdtemp(prefix="shuttle-cfgdir.")
        os.makedirs(os.path.join(folder, "git-shuttle"), mode=0o755)
        old = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = folder
        try:
            path = store_mod.config_dir()
            self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o700")
        finally:
            if old is None:
                del os.environ["XDG_CONFIG_HOME"]
            else:
                os.environ["XDG_CONFIG_HOME"] = old
            shutil.rmtree(folder, ignore_errors=True)


class TestUpdateNotice(Base):
    """The reminder that a newer release is out: the server looks at most once a day, keeps the answer, and can be told to stop."""
    start_release_page = TestUpdate.start_release_page

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config_home = tempfile.mkdtemp(prefix="shuttle-notice-config.")
        cls.old_env = {k: os.environ.get(k) for k in ("XDG_CONFIG_HOME", "GIT_SHUTTLE_NO_UPDATE_CHECK")}
        os.environ["XDG_CONFIG_HOME"] = cls.config_home
        os.environ.pop("GIT_SHUTTLE_NO_UPDATE_CHECK", None)

    @classmethod
    def tearDownClass(cls):
        for key, value in cls.old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(cls.config_home, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        shutil.rmtree(os.path.join(self.config_home, "git-shuttle"), ignore_errors=True)
        os.environ.pop("GIT_SHUTTLE_NO_UPDATE_CHECK", None)
        self.addCleanup(lambda: os.environ.pop("GIT_SHUTTLE_NO_UPDATE_CHECK", None))

    def notice(self):
        status, data = self.api("GET", "update/notice")
        self.assertEqual(status, 200, data)
        return data

    def test_the_routes_need_the_token(self):
        self.assertEqual(self.api("GET", "update/notice", token=False)[0], 401)
        self.assertEqual(self.api("POST", "update/notice", {"enabled": False}, token=False)[0], 401)

    def test_a_newer_release_is_reminded_and_looked_for_once_a_day(self):
        self.start_release_page("9.9.9")
        with mock.patch("shuttle_ui.updates._run", wraps=updates._run) as run:
            first = self.notice()
            second = self.notice()
        self.assertEqual((first["available"], first["latest"], first["enabled"], first["snoozed"]), (True, "9.9.9", True, False))
        self.assertEqual(first["current"], ui_version.__version__)
        self.assertTrue(first["notes"].endswith("/releases/tag/v9.9.9"))
        self.assertEqual(second["latest"], "9.9.9")
        self.assertEqual(run.call_count, 1, "the second answer comes from the file: one look in a day")

    def test_with_nothing_newer_there_is_no_reminder(self):
        self.start_release_page(ui_version.__version__)
        self.assertFalse(self.notice()["available"])

    def test_later_is_for_that_release_only(self):
        self.start_release_page("9.9.9")
        self.notice()
        status, data = self.api("POST", "update/notice", {"snooze": "9.9.9"})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["snoozed"])
        self.start_release_page("9.9.10")
        with mock.patch.object(updates, "NOTICE_EVERY", 0):
            data = self.notice()
        self.assertEqual(data["latest"], "9.9.10")
        self.assertFalse(data["snoozed"], "a newer release is reminded again")

    def test_turning_it_off_stops_the_looking_and_turning_it_on_looks_at_once(self):
        self.start_release_page("9.9.9")
        with mock.patch("shuttle_ui.updates._run", wraps=updates._run) as run:
            data = self.api("POST", "update/notice", {"enabled": False})[1]
            self.assertFalse(data["enabled"])
            self.assertFalse(self.notice()["enabled"])
            self.assertEqual(run.call_count, 0, "turned off: nothing is asked of the internet")
            data = self.api("POST", "update/notice", {"enabled": True})[1]
            self.assertTrue(data["enabled"] and data["available"])
            self.assertEqual(run.call_count, 1)

    def test_the_environment_turns_it_off_for_good(self):
        self.start_release_page("9.9.9")
        os.environ["GIT_SHUTTLE_NO_UPDATE_CHECK"] = "1"
        with mock.patch("shuttle_ui.updates._run", wraps=updates._run) as run:
            data = self.notice()
            data2 = self.api("POST", "update/notice", {"enabled": True})[1]
        self.assertEqual((data["enabled"], data["forced_off"], data["available"]), (False, True, False))
        self.assertEqual((data2["enabled"], data2["forced_off"]), (False, True), "the page cannot turn it on again")
        self.assertEqual(run.call_count, 0)
        os.environ["GIT_SHUTTLE_NO_UPDATE_CHECK"] = "0"
        self.assertFalse(self.notice()["forced_off"], "0 is not off")

    def test_no_network_is_not_an_error_and_it_is_tried_again_in_an_hour_not_at_every_page(self):
        os.environ["GIT_SHUTTLE_REPO"] = "http://127.0.0.1:9/acme/git-shuttle"
        self.addCleanup(lambda: os.environ.pop("GIT_SHUTTLE_REPO", None))
        with mock.patch("shuttle_ui.updates._run", wraps=updates._run) as run:
            first, second = self.notice(), self.notice()
        self.assertFalse(first["available"] or second["available"])
        self.assertEqual(run.call_count, 1, "a failed look is not repeated at every page")
        with open(os.path.join(self.config_home, "git-shuttle", "update-notice.json")) as handle:
            checked = json.load(handle)["checked"]
        self.assertAlmostEqual(time.time() + updates.RETRY_AFTER - updates.NOTICE_EVERY, checked, delta=30)

    def test_what_was_kept_is_judged_against_the_version_that_runs_now(self):
        folder = os.path.join(self.config_home, "git-shuttle")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "update-notice.json"), "w") as handle:
            json.dump({"latest": "0.0.1", "checked": time.time(), "notes": "x"}, handle)
        self.assertFalse(self.notice()["available"], "a release that is older than this one is not news")

    def test_the_values_are_validated(self):
        for body in ({"enabled": "yes"}, {"enabled": 1}, {"snooze": "../x"}, {"snooze": "abc"}, {"snooze": 9}, {"snooze": "1.2.3; rm -rf /"}):
            self.assertEqual(self.api("POST", "update/notice", body)[0], 400, body)
        self.api("POST", "update/notice", {"enabled": True})
        path = os.path.join(self.config_home, "git-shuttle", "update-notice.json")
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600, "what is kept is private")


class TestPrefs(Base):
    """What the page remembers is kept by the server (the storage of a browser is per address and port): strict keys, strict shapes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config_home = tempfile.mkdtemp(prefix="shuttle-prefs-config.")
        cls.old_config = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = cls.config_home

    @classmethod
    def tearDownClass(cls):
        if cls.old_config is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = cls.old_config
        shutil.rmtree(cls.config_home, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        shutil.rmtree(os.path.join(self.config_home, "git-shuttle"), ignore_errors=True)

    def prefs(self):
        status, data = self.api("GET", "prefs")
        self.assertEqual(status, 200, data)
        return data["prefs"]

    def test_the_routes_need_the_token(self):
        self.assertEqual(self.api("GET", "prefs", token=False)[0], 401)
        self.assertEqual(self.api("POST", "prefs", {"key": "repo", "value": "abc"}, token=False)[0], 401)

    def test_nothing_is_kept_at_first(self):
        self.assertEqual(self.prefs(), {})

    def test_the_hidden_branches_of_a_repository_are_kept_sorted_and_without_repeats(self):
        status, data = self.api("POST", "prefs", {"key": "hidden:a1b2", "value": ["refs/heads/y", "refs/heads/x", "refs/heads/x"]})
        self.assertEqual(status, 200, data)
        self.assertEqual(self.prefs(), {"hidden:a1b2": ["refs/heads/x", "refs/heads/y"]})
        self.api("POST", "prefs", {"key": "hidden:other", "value": ["refs/heads/z"]})
        self.assertEqual(set(self.prefs()), {"hidden:a1b2", "hidden:other"}, "one entry per repository")

    def test_an_empty_list_is_kept_as_an_answer_and_null_forgets_it(self):
        self.api("POST", "prefs", {"key": "hidden:a1b2", "value": []})
        self.assertEqual(self.prefs(), {"hidden:a1b2": []})
        self.api("POST", "prefs", {"key": "hidden:a1b2", "value": None})
        self.assertEqual(self.prefs(), {})

    def test_how_the_branch_list_was_left_and_the_repository_are_kept(self):
        state = {"sections": {"Local": False, "Remote": True}, "closed": ["Remote:x", "Local:19.0-feature"]}
        self.assertEqual(self.api("POST", "prefs", {"key": "picker", "value": state})[0], 200)
        self.assertEqual(self.api("POST", "prefs", {"key": "repo", "value": "342269d792"})[0], 200)
        kept = self.prefs()
        self.assertEqual(kept["picker"], {"sections": {"Local": False, "Remote": True}, "closed": ["Local:19.0-feature", "Remote:x"]})
        self.assertEqual(kept["repo"], "342269d792")

    def test_it_survives_a_new_server(self):
        self.api("POST", "prefs", {"key": "hidden:a1b2", "value": ["refs/heads/x"]})
        server = cli.make_server(0, Store(self.world.config), token="other-token-456")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=20)
        conn.request("GET", "/api/prefs", headers={"Host": "127.0.0.1:%d" % server.server_address[1], "X-Shuttle-Token": "other-token-456"})
        data = json.loads(conn.getresponse().read().decode())
        conn.close()
        self.assertEqual(data["prefs"], {"hidden:a1b2": ["refs/heads/x"]}, "another server, another port: the same settings")

    def test_only_known_keys_and_shapes_are_accepted(self):
        bad = [
            {"key": "theme", "value": "dark"}, {"key": "hidden:", "value": []}, {"key": "hidden:../x", "value": []}, {"key": "hidden:a b", "value": []},
            {"key": "hidden:a1", "value": "refs/heads/x"}, {"key": "hidden:a1", "value": [1, 2]}, {"key": "hidden:a1", "value": [""]},
            {"key": "hidden:a1", "value": ["a\u0000b"]}, {"key": "hidden:a1", "value": ["x" * 500]}, {"key": "hidden:a1", "value": ["r"] * 5001},
            {"key": "picker", "value": []}, {"key": "picker", "value": {"other": 1}}, {"key": "picker", "value": {"sections": {"Other": True}}},
            {"key": "picker", "value": {"sections": {"Local": "yes"}}}, {"key": "picker", "value": {"closed": "x"}},
            {"key": "repo", "value": "../x"}, {"key": "repo", "value": 5}, {"key": 5, "value": "a"}, {"value": "a"}, {"key": "__proto__", "value": {}},
        ]
        for body in bad:
            status, _ = self.api("POST", "prefs", body)
            self.assertEqual(status, 400, body if len(json.dumps(body)) < 200 else body["key"])
        self.assertEqual(self.prefs(), {}, "nothing refused was kept")

    def test_the_other_settings_of_the_page_are_kept_as_the_text_the_page_keeps(self):
        self.assertEqual(self.api("POST", "prefs", {"key": "ls:shuttle.theme", "value": "light"})[0], 200)
        self.assertEqual(self.api("POST", "prefs", {"key": "ls:shuttle.table.worktree:v1", "value": '{"widths":[1,2]}'})[0], 200)
        self.assertEqual(self.prefs(), {"ls:shuttle.theme": "light", "ls:shuttle.table.worktree:v1": '{"widths":[1,2]}'})
        self.api("POST", "prefs", {"key": "ls:shuttle.theme", "value": None})
        self.assertNotIn("ls:shuttle.theme", self.prefs(), "null forgets it")

    def test_those_settings_are_validated_and_limited(self):
        bad = [{"key": "ls:theme", "value": "x"}, {"key": "ls:shuttle.", "value": "x"}, {"key": "ls:shuttle.a b", "value": "x"}, {"key": "ls:shuttle.a/b", "value": "x"},
               {"key": "ls:shuttle.x", "value": 5}, {"key": "ls:shuttle.x", "value": ["a"]}, {"key": "ls:shuttle.x", "value": "a\u0000b"},
               {"key": "ls:shuttle.x", "value": "x" * 20001}, {"key": "ls:shuttle." + "k" * 90, "value": "x"}]
        for body in bad:
            self.assertEqual(self.api("POST", "prefs", body)[0], 400, body["key"][:30])
        for i in range(200):
            self.assertEqual(self.api("POST", "prefs", {"key": "ls:shuttle.k%d" % i, "value": "v"})[0], 200)
        self.assertEqual(self.api("POST", "prefs", {"key": "ls:shuttle.one_more", "value": "v"})[0], 400, "a limit: the file cannot grow without end")
        self.assertEqual(self.api("POST", "prefs", {"key": "ls:shuttle.k0", "value": "changed"})[0], 200, "a setting that is kept can still change")

    def test_what_is_kept_is_private_and_a_damaged_file_is_not_fatal(self):
        self.api("POST", "prefs", {"key": "repo", "value": "abc123"})
        path = os.path.join(self.config_home, "git-shuttle", "prefs.json")
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        with open(path, "w") as handle:
            handle.write("{ not json")
        self.assertEqual(self.prefs(), {}, "the page works, it only forgets")
        self.assertEqual(self.api("POST", "prefs", {"key": "repo", "value": "abc123"})[0], 200, "and keeps again")


if __name__ == "__main__":
    unittest.main(verbosity=2)
