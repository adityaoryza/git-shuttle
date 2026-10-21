"""What the UI keeps on your machine: the repositories you registered, and what was run. Both in ~/.config/git-shuttle (private)."""
import json
import os
import threading
import uuid

from .errors import BadRequest


def config_dir():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, "git-shuttle")
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


class Store:
    def __init__(self, directory):
        self.dir = directory
        self.lock = threading.Lock()
        self.repos_file = os.path.join(directory, "repos.json")
        self.history_file = os.path.join(directory, "history.jsonl")

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

    def add_repo(self, path):
        with self.lock:
            repos = self.repos()
            for r in repos:
                if r["path"] == path:
                    return r
            repo = {"id": uuid.uuid4().hex[:10], "path": path, "name": os.path.basename(path)}
            repos.append(repo)
            self.save_repos(repos)
            return repo

    def remove_repo(self, repo_id):
        with self.lock:
            self.save_repos([r for r in self.repos() if r["id"] != repo_id])

    def find(self, repo_id):
        for r in self.repos():
            if r["id"] == repo_id:
                return r
        raise BadRequest("unknown repository", 404)

    def log(self, entry):
        with self.lock:
            with open(self.history_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            os.chmod(self.history_file, 0o600)

    def history(self, limit=100):
        try:
            with open(self.history_file, encoding="utf-8") as f:
                lines = f.readlines()[-limit:]
        except OSError:
            return []
        out = []
        for line in lines:
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return list(reversed(out))
