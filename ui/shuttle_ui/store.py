"""What the UI keeps on your machine: the repositories you registered, and what was run. Both in ~/.config/git-shuttle (private)."""
import itertools
import json
import os
import threading
import uuid

from .errors import BadRequest


MAX_HISTORY_BYTES = 5 * 1024 * 1024     # past this the file is rotated: the old one is kept once as history.1.jsonl
MAX_PAGE = 200
STATES = ("done", "stopped", "failed")


def config_dir():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, "git-shuttle")
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)       # it holds the paths of your repositories and what was run
    return path


class Store:
    def __init__(self, directory):
        self.dir = directory
        self.lock = threading.Lock()
        self.repos_file = os.path.join(directory, "repos.json")
        self.history_file = os.path.join(directory, "history.jsonl")
        self._next_id = None

    def repos(self):
        try:
            with open(self.repos_file, encoding="utf-8") as f:
                data = json.load(f)
            return [r for r in data if isinstance(r, dict) and "id" in r and "path" in r]
        except (OSError, ValueError):
            return []

    def save_repos(self, repos):
        tmp = self.repos_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(repos, f, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.repos_file)

    def add_repo(self, path, name=None):
        """Register a repository; `name` is the display name (default: the folder name). The same path is added once."""
        with self.lock:
            repos = self.repos()
            for r in repos:
                if r["path"] == path:
                    return r
            repo = {"id": uuid.uuid4().hex[:10], "path": path, "name": name or os.path.basename(path)}
            repos.append(repo)
            self.save_repos(repos)
            return repo

    def rename_repo(self, repo_id, name):
        """Change the display name (two repositories may share one: the path tells them apart)."""
        with self.lock:
            repos = self.repos()
            for r in repos:
                if r["id"] == repo_id:
                    r["name"] = name
                    self.save_repos(repos)
                    return r
        raise BadRequest("unknown repository", 404)

    def remove_repo(self, repo_id):
        with self.lock:
            self.save_repos([r for r in self.repos() if r["id"] != repo_id])

    def find(self, repo_id):
        for r in self.repos():
            if r["id"] == repo_id:
                return r
        raise BadRequest("unknown repository", 404)

    def _history_files(self):
        """Newest first: the current file, then the one a rotation left."""
        return [f for f in (self.history_file, self.history_file[:-len(".jsonl")] + ".1.jsonl") if os.path.exists(f)]

    def _entries(self):
        """Every entry, newest first (a damaged line is skipped)."""
        for path in self._history_files():
            try:
                with open(path, encoding="utf-8") as f:
                    lines = f.readlines()
            except OSError:
                continue
            for line in reversed(lines):
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict):
                    yield entry

    def log(self, entry):
        """Append one entry; it gets the next id (stable, growing) and the file rotates past MAX_HISTORY_BYTES."""
        with self.lock:
            if self._next_id is None:
                self._next_id = 1 + max((e.get("id", 0) for e in itertools.islice(self._entries(), 1) if isinstance(e.get("id"), int)), default=0)
            entry = dict(entry, id=self._next_id)
            self._next_id += 1
            with open(self.history_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            os.chmod(self.history_file, 0o600)
            if os.path.getsize(self.history_file) > MAX_HISTORY_BYTES:
                rotated = self.history_file[:-len(".jsonl")] + ".1.jsonl"
                os.replace(self.history_file, rotated)
                os.chmod(rotated, 0o600)
            return entry

    def clear_history(self):
        with self.lock:
            for path in self._history_files():
                os.remove(path)

    def history(self, limit=100):
        return list(itertools.islice(self._entries(), limit))

    def history_page(self, before=None, limit=50, repo=None, action=None, result=None, q=None, since=None):
        """One page of the history, newest first. `before` is the id of the last entry of the previous page.

        Returns the entries, the cursor for the next page (None at the end), how many entries match in all, and how many of those
        there are per result (not narrowed by `result`, so that the filter can show what each choice would give).
        """
        limit = max(1, min(int(limit or 50), MAX_PAGE))
        needle = (q or "").strip().lower()

        def matches(e, with_result):
            if repo and e.get("repo") != repo:
                return False
            if action and e.get("action") != action:
                return False
            if with_result and result and e.get("state") != result:
                return False
            if since and (e.get("time") or "") < since:
                return False
            if needle and needle not in " ".join([str(e.get("repo", "")), str(e.get("action", "")), str(e.get("label", "")), " ".join(e.get("commands") or [])]).lower():
                return False
            return True

        total, counts, page, more = 0, {state: 0 for state in STATES}, [], False
        for e in self._entries():
            if not matches(e, False):
                continue
            counts[e.get("state")] = counts.get(e.get("state"), 0) + 1
            if not matches(e, True):
                continue
            total += 1
            if before is not None and isinstance(e.get("id"), int) and e["id"] >= before:
                continue
            if len(page) < limit:
                page.append(e)
            else:
                more = True
        return {"entries": page, "next": page[-1].get("id") if page and more else None, "total": total, "counts": counts}

    def facets(self):
        """The repositories and actions that appear in the history, for the filters."""
        repos, actions = set(), set()
        for e in self._entries():
            repos.add(e.get("repo")); actions.add(e.get("action"))
        return {"repos": sorted(x for x in repos if x), "actions": sorted(x for x in actions if x)}
