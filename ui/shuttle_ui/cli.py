"""Command line: start the server, register repositories, open the browser."""
import argparse
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import webbrowser

from . import __author__, __version__, log
from .http import UIServer
from .runner import child_env
from .store import Store, config_dir

LAUNCH_WAIT = 2     # seconds to see whether a Linux-side opener fails at once
# The link this server prints. Only a link of exactly this shape is ever put inside a PowerShell command.
SAFE_URL = re.compile(r"^http://127\.0\.0\.1:\d+/#token=[A-Za-z0-9_-]+$")
WINDOWS_CWD = "/mnt/c"      # Windows programs started from a Linux folder complain about UNC paths


def make_server(port=0, store=None, token=None, verbose=False):
    """A server on 127.0.0.1 (never another interface); port 0 picks a free one."""
    return UIServer(("127.0.0.1", port), store or Store(config_dir()), token or secrets.token_urlsafe(32), verbose)


def running_in_wsl(environ=None, proc_version="/proc/version"):
    environ = os.environ if environ is None else environ
    if environ.get("WSL_DISTRO_NAME") or environ.get("WSL_INTEROP"):
        return True
    try:
        with open(proc_version, encoding="utf-8", errors="replace") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


def openers(url, wsl, platform):
    """The commands that can open `url` here, best first.

    Under WSL the Windows side comes first, because xdg-open may exist and do nothing. explorer.exe is never used: it takes
    the link for a path and opens a folder.
    """
    if wsl:
        commands = [["wslview", url], ["rundll32.exe", "url.dll,FileProtocolHandler", url]]
        if SAFE_URL.match(url):
            commands.append(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Start-Process '%s'" % url])
        return commands + [["cmd.exe", "/c", "start", "", url], ["xdg-open", url], ["gio", "open", url]]
    if platform == "darwin":
        return [["open", url]]
    return [["xdg-open", url], ["gio", "open", url], ["sensible-browser", url]]


def launch(argv):
    """Start an opener without a shell; true when it started.

    A Windows program (.exe) counts as started once it runs: its exit status says nothing about the browser. For the
    others, a failure within a moment means the next opener should be tried.
    """
    windows = os.path.basename(argv[0]).lower().endswith(".exe")
    cwd = WINDOWS_CWD if windows and os.path.isdir(WINDOWS_CWD) else None
    try:
        proc = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        return False
    if windows:
        return True
    try:
        return proc.wait(timeout=LAUNCH_WAIT) == 0
    except subprocess.TimeoutExpired:
        return True         # still running: a launcher that stays alive while the browser starts


def open_browser(url, environ=None, wsl=None, platform=None, fallback=webbrowser.open):
    """Open `url` in the default browser; false when nothing worked.

    GIT_SHUTTLE_BROWSER names a command to use instead (split like a shell would, the URL appended, never run by a shell).
    """
    environ = os.environ if environ is None else environ
    path = environ.get("PATH", os.defpath)
    custom = environ.get("GIT_SHUTTLE_BROWSER", "").strip()
    if custom:
        try:
            command = shlex.split(custom)
        except ValueError:
            return False
        program = shutil.which(command[0], path=path) if command else None
        return bool(program) and launch([program] + command[1:] + [url])
    wsl = running_in_wsl(environ) if wsl is None else wsl
    for command in openers(url, wsl, sys.platform if platform is None else platform):
        program = shutil.which(command[0], path=path)
        if program and launch([program] + command[1:]):
            return True
    try:
        return bool(fallback(url))
    except Exception:       # no usable browser module either
        return False


def register_repos(store, paths):
    for path in paths:
        real = os.path.realpath(path)
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
        if done.returncode != 0:
            sys.exit("not a git repository: %s" % path)
        store.add_repo(os.path.realpath(done.stdout.decode().strip()))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="git shuttle ui", description="The git-shuttle web UI (listens on 127.0.0.1 only).")
    parser.add_argument("--port", type=int, default=7788, help="port to listen on (default 7788; a free one is used when it is taken)")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    parser.add_argument("--repo", action="append", default=[], metavar="PATH", help="register a repository (repeatable)")
    noise = parser.add_mutually_exclusive_group()
    noise.add_argument("--verbose", action="store_true", help="also log every request, and tracebacks of unexpected errors")
    noise.add_argument("--quiet", action="store_true", help="log only warnings and errors")
    args = parser.parse_args(argv)

    log.configure(verbose=args.verbose, quiet=args.quiet)
    store = Store(config_dir())
    register_repos(store, args.repo)
    try:
        server = make_server(args.port, store, verbose=args.verbose)
    except OSError:
        server = make_server(0, store, verbose=args.verbose)
    port = server.server_address[1]
    link = "http://127.0.0.1:%d/#token=%s" % (port, server.token)
    stopping = stop_on_signal(server)
    log.LOGGER.info("git-shuttle %s by %s listening on http://127.0.0.1:%d (this machine only)", __version__, __author__, port)
    log.LOGGER.info("settings and history in %s, %d repositories registered", log.clean(store.dir, 200), len(store.repos()))
    print("Open this link in your browser (it holds the access token: keep it private):\n  %s" % link, flush=True)
    if not args.no_open:
        print("Opened in your default browser." if open_browser(link) else "Could not open a browser by itself: open the link above in your browser.", flush=True)
    log.LOGGER.info("Ctrl-C to stop")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    if stopping.is_set():
        log.LOGGER.info("stopped")


def stop_on_signal(server):
    """Make Ctrl-C and SIGTERM stop the server cleanly. A second one while it stops ends the process at once, without a traceback."""
    stopping = threading.Event()

    def interrupted(signum, frame):
        if stopping.is_set():
            os._exit(130)
        stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()   # shutdown() cannot be called from the thread that serves

    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, interrupted)
    return stopping
