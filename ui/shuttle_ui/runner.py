"""Running git-shuttle: one command in a repository, and reading its machine-readable output. Never through a shell."""
import os
import signal
import subprocess
import threading

from .errors import BadRequest
from .paths import SHUTTLE_ARGV


# What the server starts never gets the terminal of the server: no input, and no controlling terminal to open (/dev/tty). ssh asks for a
# password there, and git for a passphrase: that prompt would show in the window that runs `git shuttle ui`, where nobody can see why the page waits.
NO_TERMINAL = {"stdin": subprocess.DEVNULL, "start_new_session": True}

MAX_OUTPUT = 256 * 1024     # of what a job reports back to the page

# Variables that would point git at another repository, index or diff program than the one a request names.
_DROPPED_ENV = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
                "GIT_EXTERNAL_DIFF", "GIT_NAMESPACE", "GIT_COMMON_DIR", "GIT_PREFIX")


def child_env(extra=None):
    env = {key: value for key, value in os.environ.items() if key not in _DROPPED_ENV}
    # Paths come from git itself or from the page: they name files, never patterns.
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "GIT_EDITOR": "true", "NO_COLOR": "1", "GIT_LITERAL_PATHSPECS": "1"})
    if extra:
        env.update(extra)
    return env


def limited(raw):
    """Decode command output for the page, cutting it at MAX_OUTPUT bytes."""
    if len(raw) <= MAX_OUTPUT:
        return raw.decode("utf-8", "replace")
    return raw[:MAX_OUTPUT].decode("utf-8", "replace") + "\n[output cut: more than %d KiB]" % (MAX_OUTPUT // 1024)


def run_shuttle(repo_path, args, dry_run=False, timeout=120, extra_env=None, on_output=None):
    """One git-shuttle command in a repository; returns (exit status, output).

    on_output(text) gets everything printed so far each time more arrives, so that a long command can be followed while it runs.
    """
    argv = SHUTTLE_ARGV + ["-n" if dry_run else "-y"] + list(args)
    if on_output is None:
        try:
            done = subprocess.run(argv, cwd=repo_path, env=child_env(extra_env), capture_output=True, **NO_TERMINAL, timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124, "timed out"
        return done.returncode, limited(done.stdout + done.stderr)
    proc = subprocess.Popen(argv, cwd=repo_path, env=child_env(extra_env), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **NO_TERMINAL)
    expired = threading.Event()
    timer = threading.Timer(timeout, lambda: (expired.set(), _end(proc)))
    timer.start()
    out = b""
    try:
        for chunk in iter(lambda: os.read(proc.stdout.fileno(), 4096), b""):
            out += chunk
            on_output(limited(out))
    finally:
        timer.cancel()
        proc.stdout.close()
        code = proc.wait()
    if expired.is_set():
        return 124, limited(out) + "\ntimed out"
    return code, limited(out)


def _end(proc):
    """Ends a command that ran too long, with what it started (it has its own session)."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        pass


def parse_porcelain(raw):
    """NUL separated key=value records -> a dict; the repeating keys become lists."""
    repeating = {"file", "conflict", "blocker", "candidate", "commit"}
    out = {}
    for rec in raw.split(b"\0"):
        if not rec:
            continue
        key, _, value = rec.decode("utf-8", "replace").partition("=")
        if key in repeating:
            out.setdefault(key, []).append(value)
        else:
            out[key] = value
    for key in repeating:
        out.setdefault(key, [])
    return out


def shuttle_porcelain(repo_path, command, timeout=60, extra=()):
    done = subprocess.run(SHUTTLE_ARGV + [command] + list(extra) + ["--porcelain"], cwd=repo_path, env=child_env(), capture_output=True, **NO_TERMINAL, timeout=timeout)
    if done.returncode != 0:
        raise BadRequest((done.stdout + done.stderr).decode("utf-8", "replace").strip() or "git-shuttle failed", 500)
    return parse_porcelain(done.stdout)


def git_output(repo_path, *args, timeout=120):
    """A fixed, read-only git command (the arguments never come from the page).

    No file-system monitor hook runs (a repository can configure one), and `git status` does not take the optional lock
    that refreshes the index. Git may still update the stat cache of the index, as it does for any user.
    """
    argv = ["git", "-c", "core.fsmonitor=false"] + list(args)
    return subprocess.run(argv, cwd=repo_path, env=child_env({"GIT_OPTIONAL_LOCKS": "0"}), capture_output=True, **NO_TERMINAL, timeout=timeout)


def shuttle_records(repo_path, args, timeout=60):
    """A read-only git-shuttle command whose porcelain output is NUL separated records of unit-separated fields."""
    done = subprocess.run(SHUTTLE_ARGV + list(args) + ["--porcelain"], cwd=repo_path, env=child_env(), capture_output=True, **NO_TERMINAL, timeout=timeout)
    if done.returncode != 0:
        raise BadRequest((done.stdout + done.stderr).decode("utf-8", "replace").strip() or "git-shuttle failed", 500)
    return [rec.decode("utf-8", "replace").split("\x1f") for rec in done.stdout.split(b"\0") if rec]


def shuttle_stdin(repo_path, args, data, timeout=75):
    """A git-shuttle command that is given something on standard input (a key: never on the command line, never in a job log)."""
    done = subprocess.run(SHUTTLE_ARGV + list(args), cwd=repo_path, env=child_env(), capture_output=True, input=data, start_new_session=True, timeout=timeout)
    return done.returncode, (done.stdout + done.stderr).decode("utf-8", "replace")


def shuttle_text(repo_path, args, timeout=60):
    """A read-only git-shuttle command and its plain output (or the reason it refused)."""
    done = subprocess.run(SHUTTLE_ARGV + list(args), cwd=repo_path, env=child_env(), capture_output=True, **NO_TERMINAL, timeout=timeout)
    if done.returncode != 0:
        raise BadRequest((done.stdout + done.stderr).decode("utf-8", "replace").strip() or "git-shuttle failed", 400)
    return done.stdout.decode("utf-8", "replace")
