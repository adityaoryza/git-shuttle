"""The command log (history): paging, filters, redaction, re-run, and the other read-only routes of the page (folders, actions)."""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_server import Base, git  # noqa: E402
from shuttle_ui import actions  # noqa: E402
from shuttle_ui.redact import redact  # noqa: E402
from shuttle_ui.store import Store  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


class TestRedact(unittest.TestCase):
    def test_credentials_do_not_reach_the_log(self):
        for raw, secret in [
            ("fatal: https://user:ghp_abcdefghijklmnopqrstuv1234@github.com/a/b.git", "ghp_abcdefghijklmnopqrstuv1234"),
            ("remote: https://oauth2:hunter2@example.org/x.git", "hunter2"),
            ("token=abc123def", "abc123def"), ("Authorization: Bearer abcdef.ghijkl", "abcdef.ghijkl"), ("password: hunter2", "hunter2"),
            ("key glpat-abcdefghijklmnopqrst here", "glpat-abcdefghijklmnopqrst"),
        ]:
            self.assertNotIn(secret, redact(raw), raw)
        self.assertEqual(redact("nothing secret here"), "nothing secret here")
        self.assertIn("[cut: 90 more characters]", redact("x" * 100, 10))
        self.assertNotIn("\x1b", redact("a\x1b[31mred"), "terminal escapes are neutralised")


class TestHistory(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for i in range(130):
            cls.store.log({"time": "2026-10-%02dT10:00:%02d" % (1 + i // 60, i % 60), "repo": "alpha" if i % 3 else "beta", "action": "push" if i % 2 else "pull",
                           "label": "step %d" % i, "state": ("failed" if i % 10 == 0 else "stopped" if i % 7 == 0 else "done"), "exit": 0,
                           "commands": ["git shuttle push" if i % 2 else "git shuttle pull --ff-only"]})

    def page(self, query=""):
        status, data = self.api("GET", "history" + ("?" + query if query else ""))
        self.assertEqual(status, 200, data)
        return data

    def test_pages_follow_a_cursor_without_gaps_or_repeats(self):
        first = self.page("limit=50")
        self.assertEqual((len(first["entries"]), first["total"] >= 130), (50, True))
        ids, cursor = [e["id"] for e in first["entries"]], first["next"]
        self.assertEqual(ids, sorted(ids, reverse=True))
        while cursor:
            more = self.page("limit=50&before=%d" % cursor)
            ids += [e["id"] for e in more["entries"]]
            cursor = more["next"]
        self.assertEqual(len(ids), len(set(ids)), "no entry twice")
        self.assertEqual(ids, sorted(ids, reverse=True), "newest first all the way")
        self.assertGreaterEqual(len(ids), 130)

    def test_a_new_entry_does_not_shift_the_next_page(self):
        first = self.page("limit=20")
        self.store.log({"time": "2026-11-01T00:00:00", "repo": "alpha", "action": "push", "state": "done", "exit": 0, "commands": []})
        second = self.page("limit=20&before=%d" % first["next"])
        self.assertEqual(second["entries"][0]["id"], first["entries"][-1]["id"] - 1)

    def test_filters(self):
        self.assertTrue(all(e["repo"] == "beta" for e in self.page("repo=beta")["entries"]))
        self.assertTrue(all(e["action"] == "pull" and e["state"] == "failed" for e in self.page("action=pull&result=failed&limit=200")["entries"]))
        found = self.page("q=step+12&limit=200")["entries"]
        self.assertTrue(found and all("step 12" in e["label"] for e in found))
        self.assertTrue(all(e["time"] >= "2026-10-02" for e in self.page("since=2026-10-02&limit=200")["entries"]))
        data = self.page("repo=alpha")
        self.assertEqual(sum(data["counts"].values()), data["total"], "the counts add up when no result is chosen")
        narrowed = self.page("repo=alpha&result=failed")
        self.assertEqual(narrowed["counts"], data["counts"], "the counts are not narrowed by the result filter itself")
        self.assertEqual(narrowed["total"], data["counts"]["failed"])
        self.assertIn("alpha", data["facets"]["repos"])
        self.assertEqual(self.page("repo=nobody")["entries"], [])

    def test_bad_queries_are_refused(self):
        for query in ("before=abc", "limit=-1", "limit=x", "result=weird", "since=yesterday", "before=1;2"):
            self.assertEqual(self.api("GET", "history?" + query)[0], 400, query)
        self.assertLessEqual(len(self.page("limit=100000")["entries"]), 200, "a page is never larger than the cap")

    def test_a_job_leaves_a_redacted_entry_that_can_be_run_again(self):
        git(self.world.work, "checkout", "-q", "main")
        job = self.run_job("pull", {}, timeout=60) if False else None
        status, data = self.api("POST", "repos/%s/run" % self.rid(), {"action": "stage", "params": {"paths": ["nothing.txt"]}, "label": "Stage nothing.txt"})
        self.assertEqual(status, 200)
        self.wait(data["job"])
        entry = self.page("limit=1")["entries"][0]
        self.assertEqual((entry["action"], entry["label"], entry["repo_id"]), ("stage", "Stage nothing.txt", self.rid()))
        self.assertEqual(entry["commands"], ["git shuttle stage -- nothing.txt"])
        self.assertEqual(entry["params"], {"paths": ["nothing.txt"]}, "a stage can be run again")
        self.assertIn("exit", entry["steps"][0])
        self.assertGreaterEqual(entry["duration"], 0)
        self.run_job("push", {"force": True})      # refused on the protected branch, but logged
        forced = self.page("limit=1")["entries"][0]
        self.assertEqual(forced["action"], "push")
        self.assertNotIn("params", forced, "a force push is never offered for a re-run")

    def wait(self, job_id):
        import time
        for _ in range(100):
            if self.api("GET", "jobs/" + job_id)[1]["job"]["state"] != "running":
                return
            time.sleep(0.1)
        self.fail("the job did not finish")

    def test_clear_history(self):
        folder = tempfile.mkdtemp(prefix="shuttle-clear.")
        small = Store(folder)
        small.log({"action": "a"})
        small.clear_history()
        self.assertEqual(small.history(), [])
        self.assertEqual(small.log({"action": "b"})["id"], 2, "ids never go back")


class TestReadOnlyRoutes(Base):
    def test_actions_are_served(self):
        status, data = self.api("GET", "actions")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["actions"]), len({a["id"] for a in data["actions"]}), "ids are unique")
        self.assertTrue(all(a["label"] and a["group"] and "cli" in a for a in data["actions"]))

    def test_browse_stays_inside_home(self):
        home = os.path.realpath(os.path.expanduser("~"))
        status, data = self.api("GET", "browse")
        self.assertEqual((status, data["path"], data["parent"]), (200, home, None))
        for outside in ("/", "/etc", "/tmp/../etc", home + "/../", "/proc/self/root"):
            self.assertIn(self.api("GET", "browse?path=" + outside)[0], (403, 404), outside)
        self.assertEqual(self.api("GET", "browse?path=" + home + "/nope-" + "x" * 5)[0], 404)
        self.assertEqual(self.api("GET", "browse?path=%00")[0], 400)

    def test_browse_marks_repositories_and_follows_no_link_out(self):
        home = os.path.realpath(os.path.expanduser("~"))
        base = tempfile.mkdtemp(prefix="shuttle-browse.", dir=home)
        try:
            os.makedirs(os.path.join(base, "plain")); git(base, "init", "-q", os.path.join(base, "project"))
            os.makedirs(os.path.join(base, ".hidden"))
            os.symlink("/etc", os.path.join(base, "to-etc"))
            data = self.api("GET", "browse?path=" + base)[1]
            self.assertEqual(data["dirs"], [{"name": "plain", "repo": False}, {"name": "project", "repo": True}])
            self.assertEqual(self.api("GET", "browse?path=" + os.path.join(base, "to-etc"))[0], 403)
            self.assertEqual(self.api("GET", "browse?path=" + os.path.join(base, "project"))[1]["repo"], True)
            self.assertEqual(self.api("GET", "browse?path=" + base)[1]["parent"], home)
        finally:
            import shutil
            shutil.rmtree(base, ignore_errors=True)


class TestParity(unittest.TestCase):
    """Everything the tool can do has a place in the page."""

    def commands(self):
        with open(os.path.join(ROOT, "bin", "git-shuttle")) as f:
            text = f.read()
        block = text[text.index('case "$command" in'):text.index("esac", text.index('case "$command" in'))]
        names = set()
        for line in block.splitlines():
            m = re.match(r"^\s{8}([a-z][a-z-]*(?:\|[a-z-]+)*)\)", line)
            if m:
                names.update(m.group(1).split("|"))
        return names - {"-h", "--help", "--version"}

    def test_every_command_has_a_place_in_the_page(self):
        ids = {a["id"] for a in actions.CATALOG}
        missing = sorted(c for c in self.commands() if c not in actions.COMMANDS)
        self.assertEqual(missing, [], "these commands are not in shuttle_ui/actions.py COMMANDS: add them (or say why they are not in the page)")
        for command, places in actions.COMMANDS.items():
            self.assertTrue(places, command)
            for place in places:
                if " " not in place:
                    self.assertIn(place, ids, "%s points at an action that does not exist" % command)

    def test_every_action_has_behaviour_in_the_page(self):
        with open(os.path.join(ROOT, "ui", "shuttle_ui", "static", "js", "ops.js")) as f:
            script = f.read()
        defined = set(re.findall(r'^  "([a-z0-9-]+)": ', script, re.M))
        missing = sorted(a["id"] for a in actions.CATALOG if a["id"] not in defined)
        self.assertEqual(missing, [], "these actions have no entry in static/js/ops.js")

    def test_cli_templates_name_real_commands(self):
        commands = self.commands()
        for a in actions.CATALOG:
            if a["cli"]:
                self.assertEqual(a["cli"].split()[:1], ["git"], a["id"])
                self.assertIn(a["cli"].split()[2], commands, a["id"])

    def test_rerunnable_is_never_forceful(self):
        self.assertFalse(actions.rerunnable("push", {"force": True}))
        self.assertTrue(actions.rerunnable("push", {}))
        self.assertFalse(actions.rerunnable("pull", {"mode": "rebase"}))
        self.assertTrue(actions.rerunnable("pull", {"mode": "ff"}))
        for action in ("reset", "rewrite", "drop", "discard", "delete", "amend", "stash", "sync"):
            self.assertFalse(actions.rerunnable(action, {}), action)


if __name__ == "__main__":
    unittest.main()
