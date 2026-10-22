"""Tests of the `git shuttle ui` command line: opening the browser, and what the server prints in the terminal."""
import http.client
import json
import os
import queue
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_server import World, write  # noqa: E402  (also puts ui/ on sys.path)
from shuttle_ui import __version__, cli, log  # noqa: E402

UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui")


class FakeBin:
    """A folder of fake programs that record how they were called (arguments and folder), as the only PATH."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="shuttle-bin.")
        self.log = os.path.join(self.dir, "calls.log")

    def add(self, name, exit_code=0, sleep=0):
        path = os.path.join(self.dir, name)
        with open(path, "w") as f:
            f.write('#!/bin/sh\nprintf "%%s|%%s|%%s|" "%s" "$#" "$PWD" >> "%s"\nfor a in "$@"; do printf "[%%s]" "$a" >> "%s"; done\nprintf "\\n" >> "%s"\n%sexit %d\n'
                    % (name, self.log, self.log, self.log, "sleep %s\n" % sleep if sleep else "", exit_code))
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)

    def calls(self):
        """['name|argc|folder|[arg][arg]', ...]"""
        # a Windows launcher is not waited for: wait until the fake programs have stopped writing (a loaded machine is slower than 0.2 s)
        previous, deadline = -1, time.time() + 5
        while time.time() < deadline:
            time.sleep(0.2)
            size = os.path.getsize(self.log) if os.path.exists(self.log) else 0
            if size == previous:
                break
            previous = size
        try:
            with open(self.log) as f:
                return f.read().splitlines()
        except OSError:
            return []

    def names(self):
        return [call.split("|")[0] for call in self.calls()]

    def args(self, index=0):
        return self.calls()[index].split("|", 3)[3]

    def env(self, **extra):
        return {"PATH": self.dir, **extra}


URL = "http://127.0.0.1:7788/#token=abc_DEF-123"


class TestOpeningTheBrowser(unittest.TestCase):
    def setUp(self):
        self.bin = FakeBin()
        self.fallback_calls = []

    def fallback(self, url):
        self.fallback_calls.append(url)
        return False

    def open(self, wsl=False, platform="linux", url=URL, **env):
        return cli.open_browser(url, environ=self.bin.env(**env), wsl=wsl, platform=platform, fallback=self.fallback)

    # -- WSL: the Windows side first, never explorer.exe
    def test_wsl_prefers_wslview(self):
        for name in ("wslview", "rundll32.exe", "powershell.exe", "cmd.exe", "xdg-open"):
            self.bin.add(name)
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.names(), ["wslview"])
        self.assertEqual(self.bin.args(), "[%s]" % URL)

    def test_wsl_without_wslview_uses_rundll32_with_the_exact_arguments(self):
        for name in ("rundll32.exe", "powershell.exe", "xdg-open"):
            self.bin.add(name)
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.names(), ["rundll32.exe"])
        self.assertEqual(self.bin.args(), "[url.dll,FileProtocolHandler][%s]" % URL)

    def test_the_exit_status_of_a_windows_launcher_means_nothing(self):
        self.bin.add("rundll32.exe", exit_code=1)
        self.bin.add("powershell.exe")
        self.bin.add("xdg-open")
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.names(), ["rundll32.exe"], "nothing else is tried after it")

    def test_powershell_gets_the_link_quoted_for_it(self):
        self.bin.add("powershell.exe")
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.args(), "[-NoProfile][-NonInteractive][-Command][Start-Process '%s']" % URL)

    def test_powershell_is_never_given_a_link_that_is_not_ours(self):
        self.bin.add("powershell.exe")
        self.bin.add("cmd.exe")
        for url in ("http://127.0.0.1:7788/#token=a'b", "http://127.0.0.1:7788/#token=a b", "http://evil.example/#token=abc", "http://127.0.0.1:7788/#token=a;calc", "https://127.0.0.1:7788/#token=abc"):
            self.assertTrue(self.open(wsl=True, url=url))
        self.assertEqual(set(self.bin.names()), {"cmd.exe"}, "the strict pattern keeps it out of PowerShell")

    def test_cmd_start_gets_an_empty_title_and_the_url(self):
        self.bin.add("cmd.exe")
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.args(), "[/c][start][][%s]" % URL)

    def test_explorer_is_never_used(self):
        self.bin.add("explorer.exe")
        self.assertFalse(self.open(wsl=True))
        self.assertEqual(self.bin.calls(), [], "explorer.exe would open a folder")
        self.assertEqual(self.fallback_calls, [URL])
        self.assertFalse(any("explorer" in " ".join(c) for c in cli.openers(URL, True, "linux")))

    def test_windows_programs_start_in_a_windows_folder(self):
        self.bin.add("rundll32.exe")
        self.open(wsl=True)
        folder = self.bin.calls()[0].split("|")[2]
        if os.path.isdir(cli.WINDOWS_CWD):
            self.assertEqual(folder, cli.WINDOWS_CWD)
        else:
            self.assertNotEqual(folder, "")

    def test_linux_openers_are_the_last_resort_and_their_failure_falls_through(self):
        self.bin.add("xdg-open", exit_code=3)
        self.bin.add("gio")
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.names(), ["xdg-open", "gio"])

    def test_wslview_failing_falls_through_to_the_windows_side(self):
        self.bin.add("wslview", exit_code=2)
        self.bin.add("rundll32.exe")
        self.assertTrue(self.open(wsl=True))
        self.assertEqual(self.bin.names(), ["wslview", "rundll32.exe"])

    # -- not WSL
    def test_linux_uses_xdg_open_then_gio_then_sensible_browser_and_no_windows_program(self):
        for name in ("rundll32.exe", "cmd.exe", "powershell.exe"):
            self.bin.add(name)
        self.assertFalse(self.open(wsl=False))
        self.assertEqual(self.bin.calls(), [])
        self.bin.add("sensible-browser")
        self.assertTrue(self.open(wsl=False))
        self.assertEqual(self.bin.names(), ["sensible-browser"])

    def test_the_url_is_one_argument_with_its_fragment(self):
        self.bin.add("xdg-open")
        self.open()
        self.assertEqual(self.bin.calls()[0].split("|")[1], "1")
        self.assertEqual(self.bin.args(), "[%s]" % URL)

    def test_macos_uses_open(self):
        self.bin.add("open")
        self.bin.add("xdg-open")
        self.assertTrue(self.open(platform="darwin"))
        self.assertEqual(self.bin.names(), ["open"])

    def test_a_launcher_that_stays_alive_counts_as_started(self):
        self.bin.add("xdg-open", sleep=5)
        old, cli.LAUNCH_WAIT = cli.LAUNCH_WAIT, 0.3
        try:
            self.assertTrue(self.open())
        finally:
            cli.LAUNCH_WAIT = old

    # -- the end of the chain, and an override
    def test_nothing_found_ends_with_the_standard_library_and_then_false(self):
        self.assertFalse(self.open())
        self.assertEqual(self.fallback_calls, [URL])
        self.assertTrue(cli.open_browser(URL, environ=self.bin.env(), wsl=False, platform="linux", fallback=lambda url: True))

        def broken(url):
            raise RuntimeError("no browser")
        self.assertFalse(cli.open_browser(URL, environ=self.bin.env(), wsl=False, platform="linux", fallback=broken))

    def test_a_chosen_browser_command_is_used_alone_and_not_through_a_shell(self):
        self.bin.add("mybrowser")
        self.bin.add("xdg-open")
        self.assertTrue(self.open(GIT_SHUTTLE_BROWSER="mybrowser --new-window"))
        self.assertEqual(self.bin.names(), ["mybrowser"])
        self.assertEqual(self.bin.args(), "[--new-window][%s]" % URL)

    def test_shell_syntax_in_the_chosen_command_is_not_interpreted(self):
        marker = os.path.join(self.bin.dir, "pwned")
        self.bin.add("mybrowser")
        self.assertFalse(self.open(GIT_SHUTTLE_BROWSER="mybrowser; touch %s" % marker))
        self.assertFalse(os.path.exists(marker))
        self.assertFalse(self.open(GIT_SHUTTLE_BROWSER="unbalanced 'quote"))

    def test_detecting_wsl(self):
        proc = os.path.join(self.bin.dir, "version")
        write(proc, "Linux version 5.15.1-microsoft-standard-WSL2\n")
        self.assertTrue(cli.running_in_wsl({}, proc))
        write(proc, "Linux version 6.1 generic\n")
        self.assertFalse(cli.running_in_wsl({}, proc))
        self.assertTrue(cli.running_in_wsl({"WSL_DISTRO_NAME": "Ubuntu"}, proc))
        self.assertFalse(cli.running_in_wsl({}, os.path.join(self.bin.dir, "missing")))


class TestLogLines(unittest.TestCase):
    def test_control_characters_cannot_forge_a_line(self):
        self.assertEqual(log.clean("a\nb\x1b[31mc\r"), "a?b?[31mc?")
        self.assertEqual(len(log.clean("x" * 500)), 120)

    def test_a_job_is_summarised_by_names_and_counts(self):
        steps = [["stage", "--", "a"], ["commit", "-m", "secret", "--", "a"], ["commit", "-m", "other", "--", "b"], ["ship"]]
        self.assertEqual(log.summarize(steps), "stage, commit x2, ship")

    def test_colour_only_on_a_terminal_without_no_color(self):
        class Tty:
            def __init__(self, tty):
                self.tty, self.lines = tty, []
            def isatty(self):
                return self.tty
            def write(self, text):
                self.lines.append(text)
            def flush(self):
                pass
        def printed(tty, **env):
            stream = Tty(tty)
            old = os.environ.copy()
            os.environ.pop("NO_COLOR", None)
            os.environ.update(env)
            try:
                log.configure(stream=stream)
                log.job("repo", "ship", "started (ship)")
            finally:
                os.environ.clear(); os.environ.update(old)
            return "".join(stream.lines)
        self.assertIn("\x1b[", printed(True))
        self.assertNotIn("\x1b[", printed(True, NO_COLOR="1"))
        self.assertNotIn("\x1b[", printed(False))


class Terminal(unittest.TestCase):
    """A real `python -m shuttle_ui` process, with its stdout and stderr read like a terminal would show them."""

    @classmethod
    def setUpClass(cls):
        cls.world = World()

    def setUp(self):
        self.config = tempfile.mkdtemp(prefix="shuttle-cfg.")

    def start(self, *flags):
        env = {**os.environ, "PYTHONPATH": os.path.abspath(UI_DIR), "XDG_CONFIG_HOME": self.config, "NO_COLOR": "1", "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen([sys.executable, "-m", "shuttle_ui", "--port", "0", "--no-open", "--repo", self.world.work, *flags],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.lines = queue.Queue()
        threading.Thread(target=lambda: [self.lines.put(line) for line in self.proc.stdout], daemon=True).start()
        self.stdout = ""
        deadline = time.time() + 15
        while "#token=" not in self.stdout and time.time() < deadline:
            try:
                self.stdout += self.lines.get(timeout=0.2)
            except queue.Empty:
                pass
        match = re.search(r"127\.0\.0\.1:(\d+)/#token=(\S+)", self.stdout)
        self.assertTrue(match, "the server printed its link: %r" % self.stdout)
        self.port, self.token = int(match.group(1)), match.group(2)

    def stop(self):
        self.proc.send_signal(signal.SIGINT)
        err = self.proc.stderr.read()
        self.proc.wait(timeout=15)
        time.sleep(0.2)
        while not self.lines.empty():
            self.stdout += self.lines.get()
        return err

    def call(self, method, path, body=None, token=True, host=None, content_type="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"Host": host or "127.0.0.1:%d" % self.port}
        if token is True:
            headers["X-Shuttle-Token"] = self.token
        elif token:
            headers["X-Shuttle-Token"] = token
        payload = None
        if body is not None:
            payload = json.dumps(body) if content_type == "application/json" else str(body)
            headers["Content-Type"] = content_type
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, (json.loads(data) if data and data[:1] == b"{" else None)

    def wait_job(self, repo_id, action, params):
        status, data = self.call("POST", "/api/repos/%s/run" % repo_id, {"action": action, "params": params})
        self.assertEqual(status, 200, data)
        for _ in range(150):
            job = self.call("GET", "/api/jobs/" + data["job"])[1]["job"]
            if job["state"] != "running":
                return job
            time.sleep(0.2)
        self.fail("the job did not finish")


class TestTerminalOutput(Terminal):
    def test_default_log_has_the_banner_the_jobs_and_the_refusals_only(self):
        self.start()
        repo_id = self.call("GET", "/api/repos")[1]["repos"][0]["id"]
        self.call("GET", "/api/repos", token=False)                                  # 401
        self.call("GET", "/api/repos", host="evil.example:80")                       # 403
        self.call("POST", "/api/repos", body="x", content_type="text/plain")         # 415
        self.call("GET", "/static/../cli.py", token=False)                           # 404: not a refusal
        self.call("GET", "/api/repos?secret=SECRET-QUERY")
        self.assertEqual(self.wait_job(repo_id, "start", {"name": "log check"})["state"], "done")
        write(os.path.join(self.world.work, "private.txt"), "x\n")
        self.wait_job(repo_id, "ship", {"commits": [{"message": "[FEAT] x: SECRET-MESSAGE", "paths": ["private.txt"]}], "stage": ["private.txt"]})
        err = self.stop()
        out = self.stdout
        lines = err.splitlines()
        stamp = r"\d\d:\d\d:\d\d  "
        self.assertTrue(re.search(stamp + r"info  git-shuttle %s by Aditya Oryza Mahendra listening on http://127\.0\.0\.1:%d " % (re.escape(__version__), self.port), err), err)
        self.assertRegex(err, r"info  settings and history in .+, 1 repositories registered")
        self.assertRegex(err, stamp + r"job   my work  start  started \(start\)")
        self.assertRegex(err, stamp + r"job   my work  start  done  \d+\.\ds")
        self.assertRegex(err, stamp + r"job   my work  ship  started \(stage, commit, ship\)")
        self.assertRegex(err, stamp + r"warn  401 missing or wrong token  \(GET /api/repos from 127\.0\.0\.1\)")
        self.assertRegex(err, stamp + r"warn  403 this server answers only on its own address  \(GET /api/repos from 127\.0\.0\.1\)")
        self.assertRegex(err, stamp + r"warn  415 send JSON  \(POST /api/repos from 127\.0\.0\.1\)")
        self.assertEqual(len([l for l in lines if "warn" in l]), 3, "a 404 is not a refusal")
        self.assertRegex(err, stamp + r"info  Ctrl-C to stop")
        self.assertTrue(lines[-1].endswith("info  stopped"), lines[-1])
        self.assertNotRegex(err, r"http  ", "requests are logged only with --verbose")
        for secret in (self.token, "SECRET-MESSAGE", "SECRET-QUERY", "log check", "private.txt"):
            self.assertNotIn(secret, err, secret)
        self.assertIn("#token=" + self.token, out, "the link is on stdout, once")
        self.assertEqual(out.count(self.token), 1)
        self.assertNotIn("\x1b[", err)

    def test_verbose_logs_every_request_without_query_or_token(self):
        self.start("--verbose")
        self.call("GET", "/api/repos?x=SECRET-QUERY")
        self.call("GET", "/api/repos", token=False)
        err = self.stop()
        self.assertRegex(err, r"http  GET /api/repos 200 \d+ms")
        self.assertRegex(err, r"http  GET /api/repos 401 \d+ms")
        self.assertNotIn("SECRET-QUERY", err)
        self.assertNotIn(self.token, err)

    def test_quiet_keeps_only_problems(self):
        self.start("--quiet")
        self.call("GET", "/api/repos", token=False)
        err = self.stop()
        self.assertEqual(len(err.splitlines()), 1, err)
        self.assertIn("warn  401", err)

    def test_an_unexpected_error_is_an_error_line_and_a_traceback_only_when_verbose(self):
        gone = os.path.join(self.world.root, "gone")        # a registered folder that was deleted: git cannot even start there
        for flags, traceback in (((), False), (("--verbose",), True)):
            write(os.path.join(self.config, "git-shuttle", "repos.json"), json.dumps([{"id": "r1", "path": gone, "name": "gone"}]))
            self.start(*flags)
            status, body = self.call("GET", "/api/repos/r1/graph")
            self.assertEqual((status, body), (500, {"error": "internal error: FileNotFoundError"}))
            err = self.stop()
            self.assertRegex(err, r"error 500 GET /api/repos/r1/graph  FileNotFoundError: ")
            self.assertEqual("Traceback" in err, traceback, err)


class TestStopping(Terminal):
    def finish(self, *signals, gap=0.0):
        for number in signals:
            self.proc.send_signal(number)
            time.sleep(gap)
        err = self.proc.stderr.read()
        code = self.proc.wait(timeout=15)
        return code, err

    def test_ctrl_c_stops_the_server_cleanly(self):
        self.start()
        code, err = self.finish(signal.SIGINT)
        self.assertEqual(code, 0)
        self.assertNotIn("Traceback", err)
        self.assertEqual(err.count("info  stopped"), 1, err)

    def test_two_interrupts_in_a_row_never_print_a_traceback(self):
        for gap in (0.0, 0.05):
            self.start()
            code, err = self.finish(signal.SIGINT, signal.SIGINT, gap=gap)
            self.assertIn(code, (0, 130), (code, err))
            self.assertNotIn("Traceback", err)
            self.assertLessEqual(err.count("info  stopped"), 1, err)

    def test_sigterm_stops_it_the_same_way(self):
        self.start()
        code, err = self.finish(signal.SIGTERM)
        self.assertEqual(code, 0)
        self.assertNotIn("Traceback", err)
        self.assertEqual(err.count("info  stopped"), 1, err)

    def test_an_interrupt_during_startup_is_quiet_too(self):
        env = {**os.environ, "PYTHONPATH": os.path.abspath(UI_DIR), "XDG_CONFIG_HOME": tempfile.mkdtemp(), "NO_COLOR": "1"}
        proc = subprocess.Popen([sys.executable, "-m", "shuttle_ui", "--port", "0", "--no-open", "--repo", self.world.work], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        proc.send_signal(signal.SIGINT)
        err = proc.stderr.read()
        proc.wait(timeout=15)
        self.assertNotIn("Traceback", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
