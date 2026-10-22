"""Looking for a newer release, and installing it: `git shuttle update`, run when the page asks for it.

Nothing here runs by itself: the page calls these two routes when the user clicks. The address that is asked is fixed in the
command (the repository of git-shuttle); the page sends no parameter, so it cannot point the command anywhere else.
"""
import os
import subprocess
import threading
import time

from . import log
from .errors import BadRequest
from .paths import SHUTTLE_ARGV
from .redact import redact
from .runner import child_env, limited, parse_porcelain

_LOCK = threading.Lock()


def updates_lock():
    """The lock that lets one update run at a time (a test holds it to see the refusal)."""
    return _LOCK
CHECK_TIMEOUT = 60
APPLY_TIMEOUT = 240


def _home():
    return os.path.expanduser("~")


def _run(args, timeout):
    try:
        done = subprocess.run(SHUTTLE_ARGV + args, cwd=_home(), env=child_env(), capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise BadRequest("The release page did not answer in time: try again later.", 504)
    return done.returncode, done.stdout, done.stderr


def _reason(raw):
    """The message of the command without its 'error:' prefix."""
    text = raw.decode("utf-8", "replace").strip()
    return text[len("error: "):] if text.startswith("error: ") else text


def check():
    """What is installed, what is the latest release, and whether this copy can be updated."""
    code, out, err = _run(["update", "--check", "--porcelain"], CHECK_TIMEOUT)
    if code != 0:
        raise BadRequest(_reason(err or out) or "Could not look for a new release.", 502)
    info = parse_porcelain(out)
    return {
        "current": info.get("current", ""),
        "latest": info.get("latest", ""),
        "available": info.get("available") == "1",
        "can_update": info.get("can-update") == "1",
        "kind": info.get("kind", ""),
        "reason": info.get("reason", ""),
        "notes": info.get("notes", ""),
    }


def apply(store):
    """Install the latest release (the command asks nothing: it is the user's click that confirms). One at a time."""
    if not _LOCK.acquire(blocking=False):
        raise BadRequest("An update is already running.", 409)
    started = time.time()
    try:
        code, out, err = _run(["-y", "update"], APPLY_TIMEOUT)
        output = limited(out + err)
        installed = ""
        if code == 0:
            _, said, _ = _run(["--version"], 30)
            installed = said.decode("utf-8", "replace").strip().replace("git-shuttle ", "")
        state = "done" if code == 0 else "failed"
        store.log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "repo": "git-shuttle", "repo_id": "", "action": "update",
                   "label": "Update git-shuttle", "state": state, "exit": code, "duration": round(time.time() - started, 2),
                   "commands": ["git shuttle update"], "steps": [{"exit": code, "state": state, "output": redact(output, 4000)}]})
        log.job("git-shuttle", "update", "finished  %s  %.1fs" % ("done" if code == 0 else "failed", time.time() - started))
        if code != 0:
            raise BadRequest(_reason(err or out) or "The update failed.", 500)
        return {"ok": True, "version": installed, "output": output}
    finally:
        _LOCK.release()
