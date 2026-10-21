"""Running git-shuttle: one command in a repository, and reading its machine-readable output. Never through a shell."""
import os
import subprocess

from .errors import BadRequest
from .paths import SHUTTLE


def child_env(extra=None):
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "GIT_EDITOR": "true", "NO_COLOR": "1"})
    if extra:
        env.update(extra)
    return env


def run_shuttle(repo_path, args, dry_run=False, timeout=120, extra_env=None):
    """One git-shuttle command in a repository; returns (exit status, output)."""
    argv = [SHUTTLE, "-n" if dry_run else "-y"] + list(args)
    try:
        done = subprocess.run(argv, cwd=repo_path, env=child_env(extra_env), capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    return done.returncode, (done.stdout + done.stderr).decode("utf-8", "replace")


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


def shuttle_porcelain(repo_path, command, timeout=60):
    done = subprocess.run([SHUTTLE, command, "--porcelain"], cwd=repo_path, env=child_env(), capture_output=True, timeout=timeout)
    if done.returncode != 0:
        raise BadRequest((done.stdout + done.stderr).decode("utf-8", "replace").strip() or "git-shuttle failed", 500)
    return parse_porcelain(done.stdout)


def git_output(repo_path, *args, timeout=120):
    """A fixed, read-only git command (the arguments never come from the page)."""
    return subprocess.run(["git"] + list(args), cwd=repo_path, env=child_env(), capture_output=True, timeout=timeout)
