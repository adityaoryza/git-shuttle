"""Add-ons in the web UI: the list, enabling after a preview, the cards, and starting a branch from a task. A stand-in add-on, no network."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_server import Base, git, write  # noqa: E402
from shuttle_ui.errors import BadRequest  # noqa: E402
from shuttle_ui.validate import build_commands  # noqa: E402

PROGRAM = r'''#!/usr/bin/env bash
case "${1:-}" in
    --shuttle-manifest) echo '{"protocol":1,"name":"tracker","version":"0.2.0","description":"A tracker","hooks":["start","status","setup"],"flags":{"start":["--task"]}}' ;;
    hook)
        input=$(cat)
        case "$2:$(cat "$(dirname "$0")/mode" 2>/dev/null)" in
            setup:*) if grep -q '"action": "save"' <<<"$input"; then echo '{"ok":true,"message":"saved for tracker"}'; else echo '{"ready":false,"fields":[{"key":"token","kind":"secret","label":"Token","value":"leak","required":true}]}'; fi ;;
            start:*) echo '{"branch":"Keep the order date","reference":{"id":"15607","title":"Keep the order date","link":"https://tracker.example/15607"},"note":"found"}' ;;
            status:bad) echo '{"cards":[{"title":"x","link":"javascript:alert(1)"}]}' ;;
            status:*) echo '{"cards":[{"title":"<b>Task</b> 15607","subtitle":"Running","link":"https://tracker.example/15607","text":"A text","fields":[{"label":"Project","value":"P"}]}]}' ;;
        esac ;;
esac
'''


class TestAddons(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dir = os.path.join(cls.world.root, "addons")
        os.makedirs(cls.dir)
        write(os.path.join(cls.dir, "git-shuttle-tracker"), PROGRAM)
        os.chmod(os.path.join(cls.dir, "git-shuttle-tracker"), 0o755)
        os.environ["GIT_SHUTTLE_ADDON_PATH"] = cls.dir
        os.environ["GIT_SHUTTLE_ADDON_HOME"] = os.path.join(cls.world.root, "addon-home")

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("GIT_SHUTTLE_ADDON_PATH", None)
        os.environ.pop("GIT_SHUTTLE_ADDON_HOME", None)
        super().tearDownClass()

    def setUp(self):
        git(self.world.work, "checkout", "-q", "main", check=False)
        git(self.world.work, "config", "--remove-section", "shuttle.addon.tracker", check=False)
        for name in ("mode",):
            if os.path.exists(os.path.join(self.dir, name)):
                os.remove(os.path.join(self.dir, name))

    def listed(self):
        status, data = self.api("GET", "repos/%s/addons" % self.rid())
        self.assertEqual(status, 200, data)
        return {a["name"]: a for a in data["addons"]}

    def enable(self):
        job = self.run_job("addon-enable", {"name": "tracker"})
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])

    # -- what the page may ask for
    def test_the_names_and_the_flags_that_reach_the_command_are_validated(self):
        self.assertEqual(build_commands("addon-enable", {"name": "tracker"}), [["addon", "enable", "tracker"]])
        self.assertEqual(build_commands("addon-disable", {"name": "tracker"}), [["addon", "disable", "tracker"]])
        for bad in ("", "Tracker", "a b", "../x", "a;b", "-x", "x" * 40, None, 5):
            with self.assertRaises(BadRequest, msg=repr(bad)):
                build_commands("addon-enable", {"name": bad})
        ok = {"name": "tracker", "flag": "task", "value": "15607"}
        self.assertEqual(build_commands("start", {"addon": ok, "stash": True}), [["start", "--task", "15607", "--stash"]])
        self.assertEqual(build_commands("start", {"addon": ok, "name": "my name"}), [["start", "my name", "--task", "15607"]])
        for addon in ({**ok, "name": "../x"}, {**ok, "flag": "--task"}, {**ok, "flag": "a b"}, {**ok, "value": ""}, {**ok, "value": "a\0b"},
                      {**ok, "value": "x" * 400}, "tracker", {"name": "tracker"}):
            with self.assertRaises(BadRequest, msg=repr(addon)):
                build_commands("start", {"addon": addon})
        with self.assertRaises(BadRequest):
            build_commands("start", {})

    # -- the list, enabling, disabling
    def test_an_add_that_is_found_is_listed_then_enabled_then_disabled(self):
        self.assertEqual(self.listed()["tracker"]["state"], "found")
        self.assertEqual(self.listed()["tracker"]["flags"], [], "a flag exists only once the add-on is enabled")
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "addon-enable", "params": {"name": "tracker"}})
        self.assertEqual(status, 200, data)
        self.assertIn("hooks:       start status", data["steps"][0]["output"], "the preview says what it asks for")
        self.assertEqual(self.listed()["tracker"]["state"], "found", "a preview enables nothing")
        self.enable()
        info = self.listed()["tracker"]
        self.assertEqual((info["state"], info["version"], info["flags"]), ("enabled", "0.2.0", ["start:--task"]))
        job = self.run_job("addon-disable", {"name": "tracker"})
        self.assertEqual(job["state"], "done")
        self.assertEqual(self.listed()["tracker"]["state"], "found")

    def test_a_program_that_changed_is_listed_as_changed(self):
        self.enable()
        path = os.path.join(self.dir, "git-shuttle-tracker")
        with open(path, "a") as handle:
            handle.write("# changed\n")
        self.assertEqual(self.listed()["tracker"]["state"], "changed")
        self.enable()
        self.assertEqual(self.listed()["tracker"]["state"], "enabled")

    # -- the cards
    def test_the_cards_are_what_the_add_on_says_and_a_refused_answer_has_a_reason(self):
        self.enable()
        status, data = self.api("GET", "repos/%s/addons/cards" % self.rid())
        self.assertEqual(status, 200, data)
        card = data["cards"][0]["cards"][0]
        self.assertEqual((data["cards"][0]["addon"], card["title"], card["subtitle"]), ("tracker", "<b>Task</b> 15607", "Running"))
        self.assertEqual(data["problems"], [])
        write(os.path.join(self.dir, "mode"), "bad")
        status, data = self.api("GET", "repos/%s/addons/cards" % self.rid())
        self.assertEqual(data["cards"], [])
        self.assertIn("http or https", data["problems"][0]["problem"])
        self.assertEqual(data["problems"][0]["addon"], "tracker")

    def test_without_an_enabled_add_on_there_are_no_cards(self):
        status, data = self.api("GET", "repos/%s/addons/cards" % self.rid())
        self.assertEqual((status, data["cards"], data["problems"]), (200, [], []))

    # -- starting a branch from a task
    def test_a_branch_is_started_from_a_task_after_a_preview_that_creates_nothing(self):
        git(self.world.work, "checkout", "-q", "develop")
        self.enable()
        params = {"addon": {"name": "tracker", "flag": "task", "value": "15607"}}
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "start", "params": params})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["ok"], data)
        self.assertIn("feature/keep_the_order_date", data["steps"][0]["output"])
        self.assertEqual(git(self.world.work, "branch", "--list", "feature/keep_the_order_date"), "", "the preview made nothing")
        job = self.run_job("start", params)
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        self.assertEqual(git(self.world.work, "symbolic-ref", "--short", "HEAD"), "feature/keep_the_order_date")
        self.assertEqual(git(self.world.work, "config", "branch.feature/keep_the_order_date.shuttle-ref-id"), "15607")
        _, cards = self.api("GET", "repos/%s/addons/cards" % self.rid())
        self.assertEqual(cards["cards"][0]["addon"], "tracker")
        _, listed = self.api("GET", "repos/%s/trace/tasks" % self.rid())
        self.assertIn("15607", [t["id"] for t in listed["tasks"]], "the start is in the trace")
        status, shown = self.api("POST", "repos/%s/trace/show" % self.rid(), {"addon": "tracker", "task": "15607"})
        self.assertEqual((status, shown["events"][0]["type"]), (200, "start"))

    def test_a_flag_that_no_enabled_add_on_declared_is_refused_by_the_command(self):
        params = {"addon": {"name": "tracker", "flag": "task", "value": "1"}}
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "start", "params": params})
        self.assertEqual(status, 200)
        self.assertFalse(data["ok"])
        self.assertIn("unknown option '--task'", data["steps"][0]["output"])

    def test_the_setup_of_an_add_on_is_read_and_saved_without_showing_a_secret(self):
        self.enable()
        self.assertIn("setup", self.listed()["tracker"]["hooks"])
        status, data = self.api("GET", "repos/%s/addons/tracker/setup" % self.rid())
        self.assertEqual(status, 200, data)
        self.assertEqual(data["fields"][0]["value"], "", "a secret has no value in the answer")
        status, data = self.api("POST", "repos/%s/addons/tracker/setup" % self.rid(), {"values": {"token": "abc-123-secret"}})
        self.assertEqual((status, data["ok"]), (200, True), data)
        for body in ({"values": {"token": 5}}, {"values": "x"}, {}):
            status, _ = self.api("POST", "repos/%s/addons/tracker/setup" % self.rid(), body)
            self.assertEqual(status, 400, body)
        status, _ = self.api("GET", "repos/%s/addons/..%%2Fx/setup" % self.rid())
        self.assertIn(status, (400, 404))

    def test_the_link_of_a_branch_to_a_task_is_validated(self):
        self.assertEqual(build_commands("task-bind", {"task": "15607", "addon": "tracker", "branch": "feature/x"}),
                         [["trace", "bind", "15607", "--addon", "tracker", "--branch", "feature/x"]])
        self.assertEqual(build_commands("task-bind", {"task": "15607"}), [["trace", "bind", "15607"]])
        self.assertEqual(build_commands("task-unbind", {"branch": "feature/x"}), [["trace", "unbind", "--branch", "feature/x"]])
        with self.assertRaises(BadRequest):
            build_commands("task-unbind", {"branch": "--evil"})
        for bad in ({}, {"task": "-x"}, {"task": "1\n2"}, {"task": "1", "addon": "../x"}, {"task": "1", "branch": "--evil"}, {"task": "1", "branch": "a..b"}):
            with self.assertRaises(BadRequest):
                build_commands("task-bind", bad)

    def test_the_install_actions_validate_the_name_and_the_version(self):
        self.assertEqual(build_commands("addon-install", {"name": "odoo-task", "version": "v0.2.0"}), [["addon", "install", "odoo-task", "--version", "v0.2.0"]])
        self.assertEqual(build_commands("addon-uninstall", {"name": "odoo-task"}), [["addon", "uninstall", "odoo-task"]])
        for bad in ({"name": "../x"}, {"name": "ok", "version": "--evil"}, {"name": "ok", "version": "v1; rm"}):
            with self.assertRaises(BadRequest):
                build_commands("addon-install", bad)

    def test_the_registry_is_listed_and_an_unknown_task_has_no_trace(self):
        status, data = self.api("GET", "repos/%s/addons/available" % self.rid())
        self.assertEqual(status, 200, data)
        self.assertIn("odoo-task", [a["name"] for a in data["available"]])
        status, data = self.api("GET", "repos/%s/trace/tasks" % self.rid())
        self.assertEqual(status, 200)
        self.assertIsInstance(data["tasks"], list)
        for body in ({"addon": "../x", "task": "1"}, {"addon": "tracker", "task": "1; rm"}, {}):
            status, _ = self.api("POST", "repos/%s/trace/show" % self.rid(), body)
            self.assertEqual(status, 400, body)


class TestTraceBackfill(unittest.TestCase):
    """What a branch already did, written when it is linked to a task (lib/addons/trace.py): the dates are the real ones, and it is written once."""

    def test_the_pull_request_and_its_merge_come_with_their_dates_and_only_once(self):
        import tempfile
        import importlib.util
        spec = importlib.util.spec_from_file_location("shuttle_trace", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib", "addons", "trace.py"))
        tr = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tr)
        with tempfile.TemporaryDirectory() as tmp:
            path, prfile = os.path.join(tmp, "t", "events.jsonl"), os.path.join(tmp, "pr.json")
            with open(prfile, "w") as handle:
                json.dump({"url": "https://example.test/pr/9", "state": "MERGED", "title": "T", "baseRefName": "develop", "createdAt": "2026-02-01T09:00:00Z",
                           "mergedAt": "2026-02-03T10:30:00Z", "mergeCommit": {"oid": "a" * 40},
                           "commits": [{"oid": "b" * 40, "committedDate": "2026-02-01T08:00:00Z", "messageHeadline": "first"}]}, handle)
            who = {"addon": "tracker", "task": "15607", "title": "Title", "link": "", "branch": "feature/x"}
            os.environ["TRACE_BASE"], os.environ["TRACE_PR"] = "HEAD", prfile
            try:
                first = tr.backfill(path, who, tmp, "HEAD", prfile)
                again = tr.backfill(path, who, tmp, "HEAD", prfile)
            finally:
                os.environ.pop("TRACE_BASE", None)
                os.environ.pop("TRACE_PR", None)
            events = tr.events(path)
            self.assertEqual((first["commits"], first["pr"], first["merged"]), (1, True, True))
            self.assertEqual(sorted(e["type"] for e in events), ["commit", "merge", "pr", "start"])
            self.assertEqual({e["type"]: e["time"] for e in events}["merge"], "2026-02-03T10:30:00Z")
            self.assertEqual(len(events), len(tr.events(path)), "a second run adds nothing")
            self.assertEqual(again["commits"], 1)


class TestTraceBackfillMerged(unittest.TestCase):
    def test_a_branch_that_points_at_its_own_merge_gets_the_commits_that_the_merge_brought(self):
        import importlib.util
        import subprocess
        import tempfile
        spec = importlib.util.spec_from_file_location("shuttle_trace2", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib", "addons", "trace.py"))
        tr = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tr)
        env = dict(os.environ, GIT_AUTHOR_NAME="a", GIT_AUTHOR_EMAIL="a@a", GIT_COMMITTER_NAME="a", GIT_COMMITTER_EMAIL="a@a")
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                subprocess.run(["git", *args], cwd=tmp, env=env, check=True, capture_output=True)
            git("init", "-q", "-b", "staging")
            write(os.path.join(tmp, "a"), "1"); git("add", "a"); git("commit", "-qm", "base")
            git("checkout", "-qb", "feat")
            for name in ("b", "c"):
                write(os.path.join(tmp, name), name); git("add", name); git("commit", "-qm", "work " + name)
            git("checkout", "-q", "staging"); git("merge", "-q", "--no-ff", "-m", "Merge feat", "feat")
            git("branch", "-f", "feat", "staging")          # the branch points at the merge itself
            who = {"addon": "x", "task": "1", "title": "T", "link": "", "branch": "feat"}
            done = tr.backfill(os.path.join(tmp, "t", "e.jsonl"), who, tmp, "staging", None)
            self.assertEqual(done["commits"], 2)
            self.assertEqual(sorted(e["type"] for e in tr.events(os.path.join(tmp, "t", "e.jsonl"))), ["commit", "commit", "merge", "start"])


if __name__ == "__main__":
    unittest.main()
