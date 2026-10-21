"""Reading a commit and its diffs (read-only): the details of a commit, the changes of the working tree, and one file's diff.

Every git command here has fixed arguments; the only values from the page are a commit id (hex, checked), a path
(relative, checked) and a number of context lines (clamped). Nothing goes through a shell and nothing is written.
"""
import os
import re
import subprocess

from .errors import BadRequest
from .runner import child_env, git_output
from .validate import HASH_RE, relative_path

MAX_DIFF_BYTES = 300 * 1024
MAX_DIFF_LINES = 5000
MAX_FILES = 3000
MAX_MESSAGE = 100_000
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SOURCES = ("worktree", "staged", "untracked")
META_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%B"
STATUS_LETTERS = "AMDRCTU"


def _text(raw):
    return raw.decode("utf-8", "replace")


def check_sha(value):
    if not isinstance(value, str) or not HASH_RE.match(value):
        raise BadRequest("not a valid commit id")
    return value


def resolve_commit(repo_path, sha):
    """The full id of a commit of this repository, or a 404."""
    done = git_output(repo_path, "rev-parse", "--verify", "--quiet", sha + "^{commit}")
    full = _text(done.stdout).strip()
    if done.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", full):
        raise BadRequest("no such commit", 404)
    return full


# ---- parsing -z output ---------------------------------------------------------------------------------------------

def parse_raw(raw):
    """`git diff-tree --raw -z` → [{status, path, old_path?}] (rename and copy carry both names)."""
    parts = raw.split(b"\0")
    files, i = [], 0
    while i < len(parts):
        head = _text(parts[i])
        i += 1
        if not head.startswith(":"):
            continue
        status = head.split(" ")[-1]
        letter = status[:1]
        if letter in "RC" and i + 1 < len(parts):
            files.append({"status": letter, "old_path": _text(parts[i]), "path": _text(parts[i + 1])})
            i += 2
        elif i < len(parts):
            files.append({"status": letter if letter in STATUS_LETTERS else "M", "path": _text(parts[i])})
            i += 1
    return files


def parse_numstat(raw):
    """`git diff --numstat -z` → {path: (additions, deletions, binary)}; "-" counts mean a binary file."""
    parts = raw.split(b"\0")
    stats, i = {}, 0
    while i < len(parts):
        entry = _text(parts[i])
        i += 1
        if not entry:
            continue
        fields = entry.split("\t", 2)
        if len(fields) < 3:
            continue
        added, deleted, path = fields
        if path == "" and i + 1 < len(parts):      # a rename: the two names follow
            path = _text(parts[i + 1])
            i += 2
        binary = added == "-"
        stats[path] = (None if binary else int(added), None if binary else int(deleted), binary)
    return stats


def with_stats(files, stats):
    for f in files:
        added, deleted, binary = stats.get(f["path"], (None, None, False))
        f["additions"], f["deletions"], f["binary"] = added, deleted, binary
    return files


# ---- a commit ----------------------------------------------------------------------------------------------------

def commit_details(repo_path, sha):
    full = resolve_commit(repo_path, check_sha(sha))
    done = git_output(repo_path, "log", "-1", "--no-show-signature", "--format=" + META_FORMAT, full)
    fields = _text(done.stdout).split("\x1f", 9)
    if done.returncode != 0 or len(fields) < 10:
        raise BadRequest("cannot read that commit", 500)
    sha_, parents, author, email, at, committer, committer_email, ct, refs, message = fields
    parent_list = parents.split()
    files = commit_files(repo_path, full, parent_list)
    return {
        "sha": sha_,
        "parents": parent_list,
        "author": author, "email": email, "time": int(at) if at.isdigit() else 0,
        "committer": committer, "committer_email": committer_email, "committer_time": int(ct) if ct.isdigit() else 0,
        "refs": [r.strip() for r in refs.split(",") if r.strip()],
        "message": message.rstrip("\n")[:MAX_MESSAGE],
        "merge": len(parent_list) > 1,
        "files": files["files"], "files_truncated": files["truncated"],
    }


def _tree_args(sha, parents):
    """What to compare: the first parent against the commit (a merge shows what it changed on the first parent); a root commit against nothing."""
    return [parents[0], sha] if parents else ["--root", sha]


def commit_files(repo_path, sha, parents):
    base = ["diff-tree", "-r", "-z", "-M", "--no-ext-diff", "--no-textconv"]
    tree = _tree_args(sha, parents)
    raw = git_output(repo_path, *base, "--raw", *tree)
    nums = git_output(repo_path, *base, "--numstat", *tree)
    files = parse_raw(raw.stdout)
    truncated = len(files) > MAX_FILES
    return {"files": with_stats(files[:MAX_FILES], parse_numstat(nums.stdout)), "truncated": truncated}


# ---- the working tree --------------------------------------------------------------------------------------------

def worktree_files(repo_path):
    """Changed files grouped: staged, unstaged, untracked (the same shape as a commit's files)."""
    done = git_output(repo_path, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--find-renames")
    parts = done.stdout.split(b"\0")
    staged, unstaged, untracked, i = [], [], [], 0
    while i < len(parts):
        entry = parts[i]
        i += 1
        if len(entry) < 4:
            continue
        x, y, path = chr(entry[0]), chr(entry[1]), _text(entry[3:])
        old = None
        if x in "RC" and i < len(parts):            # the old name follows a rename or copy
            old = _text(parts[i])
            i += 1
        if x == "?" and y == "?":
            untracked.append({"status": "?", "path": path})
            continue
        if x == "!":
            continue
        conflict = "U" in (x, y) or (x, y) in (("A", "A"), ("D", "D"))
        if x not in " ?" and not conflict:
            staged.append({"status": x if x in STATUS_LETTERS else "M", "path": path, **({"old_path": old} if old else {})})
        if y not in " ?" or conflict:
            unstaged.append({"status": "U" if conflict else (y if y in STATUS_LETTERS else "M"), "path": path})
    stat_staged = parse_numstat(git_output(repo_path, "diff", "--cached", "--numstat", "-z", "-M", "--no-ext-diff", "--no-textconv").stdout)
    stat_unstaged = parse_numstat(git_output(repo_path, "diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv").stdout)
    for f in untracked:
        f.update(additions=None, deletions=None, binary=False)
    cut = lambda items: items[:MAX_FILES]
    return {
        "staged": with_stats(cut(staged), stat_staged),
        "unstaged": with_stats(cut(unstaged), stat_unstaged),
        "untracked": cut(untracked),
        "truncated": max(len(staged), len(unstaged), len(untracked)) > MAX_FILES,
    }


# ---- one file's diff ---------------------------------------------------------------------------------------------

def _capped(argv, cwd, cap=MAX_DIFF_BYTES):
    """Run git and keep at most `cap` bytes of its output (and say if there was more); the process is stopped after that."""
    proc = subprocess.Popen(argv, cwd=cwd, env=child_env({"GIT_OPTIONAL_LOCKS": "0"}), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        data = proc.stdout.read(cap + 1)
    finally:
        proc.kill()
        proc.stdout.close()
        proc.wait()
    return data[:cap], len(data) > cap


def clamp_context(value):
    if value is None:
        return 3
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 1000:
        raise BadRequest("context must be a number from 0 to 1000")
    return value


def file_diff(repo_path, source, path, old_path=None, context=3):
    """{text, truncated, binary, size}: the unified diff of one file for a commit, or for the working tree."""
    path = relative_path(path)
    old_path = relative_path(old_path) if old_path else None
    context = clamp_context(context)
    paths = [old_path, path] if old_path and old_path != path else [path]
    base = ["git", "-c", "core.quotepath=off", "-c", "core.fsmonitor=false", "-c", "diff.renames=true"]
    flags = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "-U%d" % context]
    if source == "worktree":
        argv = base + ["diff"] + flags + ["--"] + paths
    elif source == "staged":
        argv = base + ["diff", "--cached"] + flags + ["--"] + paths
    elif source == "untracked":
        return untracked_diff(repo_path, path, base, flags)
    else:
        sha = resolve_commit(repo_path, check_sha(source))
        parents = _text(git_output(repo_path, "show", "-s", "--format=%P", sha).stdout).split()
        argv = base + ["diff-tree", "-p", "-r", "--no-commit-id"] + flags + _tree_args(sha, parents) + ["--"] + paths
    data, more = _capped(argv, repo_path)
    return shape_diff(data, more)


def untracked_diff(repo_path, path, base, flags):
    """A file git does not know yet, shown as all added; a link, a folder or a missing file is said in words."""
    full = os.path.join(os.path.realpath(repo_path), path)
    root = os.path.realpath(repo_path)
    if os.path.islink(full):
        return {"text": "", "truncated": False, "binary": False, "size": 0, "note": "a symbolic link to " + os.readlink(full)}
    real = os.path.realpath(full)
    if not real.startswith(root + os.sep) or not os.path.isfile(real):
        raise BadRequest("that file is not in the working tree", 404)
    size = os.path.getsize(real)
    if size > MAX_DIFF_BYTES * 4:
        return {"text": "", "truncated": True, "binary": False, "size": size, "note": "too large to show (%d bytes)" % size}
    data, more = _capped(base + ["diff", "--no-index"] + flags + ["--", "/dev/null", path], repo_path)
    out = shape_diff(data, more)
    out["size"] = size
    return out


def shape_diff(data, more):
    text = _text(data)
    binary = "@@" not in text and ("Binary files" in text or "GIT binary patch" in text)
    if binary:
        return {"text": "", "truncated": False, "binary": True, "size": len(data)}
    lines = text.split("\n")
    truncated = more or len(lines) > MAX_DIFF_LINES
    if len(lines) > MAX_DIFF_LINES:
        text = "\n".join(lines[:MAX_DIFF_LINES]) + "\n"
    elif more:
        text = text[: text.rfind("\n") + 1] if "\n" in text else text    # never end in the middle of a line
    return {"text": text, "truncated": truncated, "binary": False, "size": len(data)}
