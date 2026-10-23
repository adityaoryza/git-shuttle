"""Looking for a newer release, and installing it: `git shuttle update`, run when the page asks for it.

check and apply run when the user clicks. The notice (a reminder that a newer release is out) is the one thing that looks by itself: at most
once an hour, from this server or from any command of git-shuttle (the page never talks to the internet), one request for the number of the latest release (what the Update button
asks, and no more: nothing about you or your repositories is sent). It can be turned off in the About dialog, or with
GIT_SHUTTLE_NO_UPDATE_CHECK=1. The address that is asked is fixed in the command (the repository of git-shuttle); the page sends no
parameter, so it cannot point the command anywhere else.
"""
import json
import os
import re
import subprocess
import tempfile
import threading
import time

from . import __version__, log
from .errors import BadRequest
from .paths import SHUTTLE_ARGV
from .redact import redact
from .runner import NO_TERMINAL, child_env, limited, parse_porcelain

_LOCK = threading.Lock()


def updates_lock():
    """The lock that lets one update run at a time (a test holds it to see the refusal)."""
    return _LOCK
CHECK_TIMEOUT = 60
APPLY_TIMEOUT = 240


def _home():
    return os.path.expanduser("~")


# -- the reminder that a newer release is out ----------------------------------------------------------------------------------

NOTICE_EVERY = 3600             # a look at most once an hour (the commands of git-shuttle make it too: update_remind in lib/commands/update.sh)
RETRY_AFTER = 3600              # when the look failed (no network): again in an hour
NOTICE_TIMEOUT = 15
_NOTICE_LOCK = threading.Lock()
_VERSION = re.compile(r"^\d+(\.\d+){1,3}$")


def _version_key(text):
    return tuple(int(part) for part in text.split(".")) if _VERSION.match(text or "") else ()


def _notice_path():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    folder = os.path.join(base, "git-shuttle")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return os.path.join(folder, "update-notice.json")


def _read_notice():
    try:
        with open(_notice_path(), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_notice(data):
    path = _notice_path()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".notice-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp):
            os.remove(tmp)


def _forced_off():
    return os.environ.get("GIT_SHUTTLE_NO_UPDATE_CHECK", "").strip() not in ("", "0")


def notice():
    """What the page shows: is a newer release out, and has the user turned the reminder off or put it off for this release.

    The look itself (a request to the release page) is made here when the last one is older than an hour, with a short wait, and its
    answer is kept: the page asks once, and the next answers come from the file."""
    with _NOTICE_LOCK:
        data = _read_notice()
        enabled = data.get("enabled", True) is not False
        off = _forced_off()
        now = time.time()
        if enabled and not off and now - float(data.get("checked", 0) or 0) >= NOTICE_EVERY:
            try:
                code, out, _ = _run(["update", "--check", "--porcelain"], NOTICE_TIMEOUT)
                info = parse_porcelain(out) if code == 0 else {}
            except BadRequest:
                info, code = {}, 1
            if code == 0 and info.get("latest"):
                data.update({"latest": info.get("latest", ""), "notes": info.get("notes", ""), "can_update": info.get("can-update") == "1",
                             "kind": info.get("kind", ""), "checked": now})
            else:
                data["checked"] = now - NOTICE_EVERY + RETRY_AFTER      # no answer: the next look is in an hour
            _write_notice(data)
        latest = data.get("latest", "")
        available = bool(latest) and _version_key(latest) > _version_key(__version__)
        return {"enabled": enabled and not off, "forced_off": off, "current": __version__, "latest": latest, "available": available,
                "can_update": bool(data.get("can_update")) and available, "kind": data.get("kind", ""), "notes": data.get("notes", ""),
                "snoozed": bool(available and data.get("snoozed") == latest)}


def set_notice(body):
    """The two things the user decides: the reminder on or off, and 'later' for the release that is out now."""
    with _NOTICE_LOCK:
        data = _read_notice()
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                raise BadRequest("enabled must be true or false")
            data["enabled"] = body["enabled"]
            if body["enabled"]:
                data["checked"] = 0         # turned on: look again at once
        if "snooze" in body:
            version = body["snooze"]
            if not isinstance(version, str) or not _VERSION.match(version):
                raise BadRequest("that is not a version")
            data["snoozed"] = version
        _write_notice(data)
    return notice()


def _run(args, timeout):
    try:
        done = subprocess.run(SHUTTLE_ARGV + args, cwd=_home(), env=child_env(), capture_output=True, **NO_TERMINAL, timeout=timeout)
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
