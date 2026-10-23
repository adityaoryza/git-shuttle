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


if __name__ == "__main__":
    unittest.main()
