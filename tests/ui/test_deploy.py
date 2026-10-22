"""Tests of the deploy of the web UI: the targets, the plan, the job, and the sudo password (which must stay out of everything it
passes through). ssh is a stand-in (GIT_SHUTTLE_SSH): no server, no network."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_server import Base, git, write  # noqa: E402

PASSWORD = "S3cret-pw!zq9"

FAKE_SSH = r'''#!/usr/bin/env bash
# the stand-in for ssh. "true" is the check. With FAKE_SSH_SUDO=1 the command asks for a sudo password on its terminal, as sudo does.
{ printf 'CALL'; printf ' [%s]' "$@"; echo; } >>"$FAKE_SSH_LOG"
for a in "$@"; do [[ "$a" == -O ]] && exit 0; done      # closing the shared connection
# With FAKE_SSH_LOGIN=1 the first connection asks for the login password on the controlling terminal, as ssh does (and later ones
# share the connection: they do not ask).
if [[ "${FAKE_SSH_LOGIN:-0}" == 1 && ! -e "$FAKE_SSH_LOG.login" ]]; then
    if [[ " $* " == *"BatchMode=yes"* ]]; then echo "deploy@host: Permission denied (publickey,password)." >&2; exit 255; fi
    for attempt in 1 2 3; do
        printf "%s's password: " deploy@host >/dev/tty
        IFS= read -rs pw </dev/tty; echo >/dev/tty
        if [[ "$pw" == "$FAKE_SSH_PASSWORD" ]]; then : >"$FAKE_SSH_LOG.login"; break; fi
        echo "Permission denied, please try again." >/dev/tty
        echo "login attempt $attempt" >>"$FAKE_SSH_LOG.attempts"
    done
    [[ -e "$FAKE_SSH_LOG.login" ]] || { echo "deploy@host: Permission denied (publickey,password)." >&2; exit 255; }
fi
last="${*: -1}"
[[ "$last" == true ]] && exit 0
if [[ "${FAKE_SSH_SUDO:-0}" == 1 ]]; then
    for attempt in 1 2 3; do
        printf '[sudo] password for deploy: '
        IFS= read -rs pw; echo
        [[ "${FAKE_SSH_ECHO:-0}" == 1 ]] && echo "typed: $pw"
        if [[ "$pw" == "$FAKE_SSH_PASSWORD" ]]; then echo "server ran: $last"; exit 0; fi
        echo "Sorry, try again."
        echo "attempt $attempt" >>"$FAKE_SSH_LOG.attempts"
    done
    echo "sudo: 3 incorrect password attempts"; exit 1
fi
echo "server ran: $last"
exit "${FAKE_SSH_RC:-0}"
'''


class TestDeploy(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        world = cls.world
        cls.ssh_log = os.path.join(world.root, "ssh.log")
        cls.ssh = os.path.join(world.root, "fakessh")
        write(cls.ssh, FAKE_SSH)
        os.chmod(cls.ssh, 0o755)
        os.environ.update({"GIT_SHUTTLE_SSH": cls.ssh, "FAKE_SSH_LOG": cls.ssh_log, "FAKE_SSH_PASSWORD": PASSWORD})
        # a module on develop
        git(world.work, "checkout", "-q", "develop")
        write(os.path.join(world.work, "sale_documents", "__manifest__.py"), "{}\n")
        write(os.path.join(world.work, "docs", "readme.txt"), "text\n")
        git(world.work, "add", "."); git(world.work, "commit", "-q", "-m", "a module"); git(world.work, "push", "-q", "origin", "develop")
        git(world.work, "checkout", "-q", "main")

    def setUp(self):
        git(self.world.work, "checkout", "-q", "main", check=False)
        for name in ("FAKE_SSH_SUDO", "FAKE_SSH_ECHO", "FAKE_SSH_LOGIN"):
            os.environ.pop(name, None)
        open(self.ssh_log, "w").close()
        for suffix in (".login", ".attempts"):
            if os.path.exists(self.ssh_log + suffix):
                os.remove(self.ssh_log + suffix)
        self.addCleanup(lambda: self.run_job("deploy-forget", {"target": "staging"}))
        self.setup_target()

    def setup_target(self, **over):
        params = {"target": "staging", "host": "deploy@203.0.113.10", "command": "staging-update {modules}", "branch": "develop",
                  "sudo": "none", "detector": "odoo", "require_name": False}
        params.update(over)
        job = self.run_job("deploy-setup", params)
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])

    def everything_on_disk(self):
        text = ""
        for folder, _, files in os.walk(self.world.root):
            if os.sep + ".git" + os.sep in folder + os.sep and os.sep + "objects" in folder:
                continue
            for name in files:
                try:
                    with open(os.path.join(folder, name), "rb") as handle:
                        text += handle.read().decode("utf-8", "replace")
                except OSError:
                    pass
        return text

    # -- targets and the plan
    def test_a_target_is_set_up_listed_and_forgotten(self):
        status, data = self.api("GET", "repos/%s/deploy" % self.rid())
        self.assertEqual(status, 200)
        target = [t for t in data["targets"] if t["target"] == "staging"][0]
        self.assertEqual((target["host"], target["branch"], target["sudo"], target["detector"]), ("deploy@203.0.113.10", "develop", "none", "odoo"))
        self.assertEqual(target["command"], "staging-update {modules}")
        job = self.run_job("deploy-forget", {"target": "staging"})
        self.assertEqual(job["state"], "done")
        _, data = self.api("GET", "repos/%s/deploy" % self.rid())
        self.assertEqual([t for t in data["targets"] if t["target"] == "staging"], [])

    def test_the_plan_finds_the_modules_and_connects_to_nothing(self):
        status, data = self.api("POST", "repos/%s/deploy/plan" % self.rid(), {"target": "staging"})
        self.assertEqual(status, 200, data)
        plan = data["plan"]
        self.assertEqual(plan["modules"], "sale_documents")
        self.assertEqual(plan["command"], "staging-update sale_documents")
        self.assertEqual((plan["branch"], plan["sudo"], plan["needs-modules"]), ("develop", "none", "0"))
        self.assertEqual(open(self.ssh_log).read(), "")

    def test_the_plan_refuses_what_is_not_valid(self):
        for body in ({"target": "../x"}, {"target": "Staging"}, {"target": "staging", "modules": "a;rm -rf /"}, {"target": "nothing"}):
            status, _ = self.api("POST", "repos/%s/deploy/plan" % self.rid(), body)
            self.assertEqual(status, 400, body)

    def test_a_branch_that_is_not_on_the_remote_is_told_so(self):
        self.setup_target(target="ghost", branch="nowhere")
        self.addCleanup(lambda: self.run_job("deploy-forget", {"target": "ghost"}))
        status, data = self.api("POST", "repos/%s/deploy/plan" % self.rid(), {"target": "ghost"})
        self.assertEqual(status, 400)
        self.assertIn("push it first", data["error"])

    # -- the run
    def test_a_deploy_runs_the_command_on_the_server(self):
        job = self.run_job("deploy", {"target": "staging"})
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        self.assertIn("server ran: staging-update sale_documents", job["steps"][-1]["output"])
        log = open(self.ssh_log).read()
        self.assertIn("[-o] [BatchMode=yes]", log)
        self.assertIn("[--] [deploy@203.0.113.10] [staging-update sale_documents]", log)

    def test_the_preview_shows_the_command_and_runs_nothing(self):
        status, data = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "deploy", "params": {"target": "staging"}})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["ok"], data)
        self.assertIn("staging-update sale_documents", data["steps"][0]["output"])
        self.assertEqual(open(self.ssh_log).read(), "")

    def test_values_that_reach_ssh_or_a_shell_are_validated(self):
        bad = [
            ("deploy", {"target": "staging; rm -rf /"}),
            ("deploy", {"target": "staging", "modules": "a b"}),
            ("deploy", {"target": "staging", "modules": "$(id)"}),
            ("deploy", {"target": "staging", "confirm": "../x"}),
            ("deploy-setup", {"target": "x", "host": "-oProxyCommand=id", "command": "x", "branch": "develop"}),
            ("deploy-setup", {"target": "x", "host": "h;id", "command": "x", "branch": "develop"}),
            ("deploy-setup", {"target": "x", "host": "h", "command": "-rf", "branch": "develop"}),
            ("deploy-setup", {"target": "x", "host": "h", "command": "x", "branch": "develop", "sudo": "yes"}),
            ("deploy-setup", {"target": "x", "host": "h", "command": "x", "branch": "develop", "port": "70000"}),
            ("deploy-setup", {"target": "x", "host": "h", "command": "x", "branch": "--force"}),
        ]
        for action, params in bad:
            status, _ = self.api("POST", "repos/%s/run" % self.rid(), {"action": action, "params": params})
            self.assertEqual(status, 400, (action, params))

    # -- the sudo password
    def run_with_password(self, password, params=None, action="deploy"):
        status, data = self.api("POST", "repos/%s/run" % self.rid(),
                                {"action": action, "params": dict({"target": "staging", "sudo_password": password}, **(params or {}))})
        self.assertEqual(status, 200, data)
        import time
        deadline = time.time() + 60
        while time.time() < deadline:
            _, d = self.api("GET", "jobs/" + data["job"])
            if d["job"]["state"] != "running":
                return d["job"], d
            time.sleep(0.1)
        self.fail("the job did not finish")

    def test_the_password_is_typed_at_the_prompt_and_goes_nowhere_else(self):
        self.setup_target(sudo="ask")
        os.environ["FAKE_SSH_SUDO"] = "1"
        job, answer = self.run_with_password(PASSWORD)
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        self.assertIn("server ran: staging-update sale_documents", job["steps"][-1]["output"])
        self.assertIn("-t", [w.strip("[]") for w in open(self.ssh_log).read().split()], "ssh gets a terminal for sudo")
        self.assertNotIn(PASSWORD, str(answer), "not in the answer about the job")
        self.assertNotIn("sudo_password", str(answer), "not even its name: it is not part of the job")
        _, history = self.api("GET", "history")
        self.assertNotIn(PASSWORD, str(history))
        self.assertNotIn(PASSWORD, self.everything_on_disk(), "not in any file: the history, the config, the logs")
        self.assertNotIn(PASSWORD, open(self.ssh_log).read(), "not in the arguments of ssh")

    def test_a_password_that_the_terminal_echoes_is_cut_out_of_the_output(self):
        self.setup_target(sudo="ask")
        os.environ.update({"FAKE_SSH_SUDO": "1", "FAKE_SSH_ECHO": "1"})
        job, answer = self.run_with_password(PASSWORD)
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        self.assertIn("typed: ***", job["steps"][-1]["output"])
        self.assertNotIn(PASSWORD, str(answer))
        _, history = self.api("GET", "history")
        self.assertNotIn(PASSWORD, str(history))

    def test_a_wrong_password_is_not_sent_again(self):
        self.setup_target(sudo="ask")
        os.environ["FAKE_SSH_SUDO"] = "1"
        job, answer = self.run_with_password("not-the-password")
        self.assertEqual(job["state"], "failed")
        self.assertIn("did not accept the password", job["steps"][-1]["output"])
        attempts = open(self.ssh_log + ".attempts").read().split("\n") if os.path.exists(self.ssh_log + ".attempts") else []
        self.assertEqual(len([a for a in attempts if a]), 1, "sudo saw the password once, not three times")
        self.assertNotIn("not-the-password", str(answer))

    def test_the_login_password_is_typed_at_the_prompt_of_ssh(self):
        os.environ["FAKE_SSH_LOGIN"] = "1"
        job, answer = self.run_with_password(PASSWORD)
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        self.assertIn("server ran: staging-update sale_documents", job["steps"][-1]["output"])
        log = open(self.ssh_log).read()
        self.assertIn("[ControlMaster=auto]", log, "one shared connection: the password is asked once")
        self.assertNotIn(PASSWORD, str(answer))
        _, history = self.api("GET", "history")
        self.assertNotIn(PASSWORD, str(history))
        self.assertNotIn(PASSWORD, self.everything_on_disk())

    def test_the_connection_test_takes_the_password_too_and_runs_nothing_on_the_server(self):
        os.environ["FAKE_SSH_LOGIN"] = "1"
        job, answer = self.run_with_password(PASSWORD, action="deploy-check")
        self.assertEqual(job["state"], "done", job["steps"][-1]["output"])
        log = open(self.ssh_log).read()
        self.assertIn("[true]", log)
        self.assertNotIn("[staging-update", log, "the command of the target is not run by the test")
        self.assertNotIn(PASSWORD, str(answer))
        os.remove(self.ssh_log + ".login")          # a new connection: the stand-in asks again
        job = self.run_job("deploy-check", {"target": "staging"})
        self.assertEqual(job["state"], "failed", "without a password and a terminal there is no login")

    def test_a_command_that_is_not_found_says_what_to_do(self):
        self.run_job("deploy-setup", {"target": "staging", "host": "nf@203.0.113.10", "command": "staging-update", "branch": "develop", "sudo": "none",
                                      "detector": "none", "require_name": False})
        os.environ["FAKE_SSH_RC"] = "127"
        self.addCleanup(lambda: os.environ.pop("FAKE_SSH_RC", None))
        job = self.run_job("deploy", {"target": "staging"})
        self.assertEqual(job["state"], "stopped", job["steps"][-1]["output"])
        self.assertIn("did not find the command", job["steps"][-1]["output"])
        self.assertIn("bash -ic", job["steps"][-1]["output"])

    def test_a_wrong_login_password_is_not_sent_again(self):
        os.environ["FAKE_SSH_LOGIN"] = "1"
        job, answer = self.run_with_password("not-the-password")
        self.assertEqual(job["state"], "failed")
        self.assertIn("did not accept the password", job["steps"][-1]["output"])
        attempts = [a for a in open(self.ssh_log + ".attempts").read().split("\n") if a] if os.path.exists(self.ssh_log + ".attempts") else []
        self.assertEqual(len(attempts), 1, "the server saw the password once, not three times")
        self.assertNotIn("not-the-password", str(answer))

    def test_a_server_that_asks_for_a_login_password_without_one_given_says_so(self):
        os.environ["FAKE_SSH_LOGIN"] = "1"
        job = self.run_job("deploy", {"target": "staging"})
        self.assertEqual(job["state"], "failed")
        self.assertIn("only use a key", job["steps"][-1]["output"])

    def test_a_server_that_asks_without_a_password_given_fails_with_a_reason(self):
        self.setup_target(sudo="ask")
        job = self.run_job("deploy", {"target": "staging"})
        self.assertEqual(job["state"], "failed")
        self.assertIn("sudo password", job["steps"][-1]["output"])
        self.assertNotIn("[sudo]", open(self.ssh_log).read())

    def test_a_password_is_only_for_a_deploy_and_must_be_sane(self):
        for password in ("", "a\nb", "a\x00b", "x" * 300, 12, None):
            status, _ = self.api("POST", "repos/%s/run" % self.rid(), {"action": "deploy", "params": {"target": "staging", "sudo_password": password}})
            self.assertEqual(status, 400, repr(password))
        status, _ = self.api("POST", "repos/%s/run" % self.rid(), {"action": "fetch", "params": {"sudo_password": PASSWORD}})
        self.assertEqual(status, 400, "another action never takes one")
        status, _ = self.api("POST", "repos/%s/preview" % self.rid(), {"action": "deploy", "params": {"target": "staging", "sudo_password": PASSWORD}})
        self.assertNotEqual(status, 500)


if __name__ == "__main__":
    unittest.main(verbosity=2)
