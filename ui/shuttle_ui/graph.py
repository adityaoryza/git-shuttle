"""The commit graph: a read-only `git log` with fixed arguments, returned as plain records for the page to draw."""
from .runner import git_output

FIELDS = "%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s"
MAX_COMMITS = 400


def parse_log(raw):
    commits = []
    for line in raw.decode("utf-8", "replace").split("\n"):
        if not line:
            continue
        sha, parents, author, when, refs, subject = (line.split("\x1f") + [""] * 6)[:6]
        commits.append({
            "sha": sha,
            "parents": parents.split(),
            "author": author,
            "time": int(when) if when.isdigit() else 0,
            "refs": [r.strip() for r in refs.split(",") if r.strip()],
            "subject": subject,
        })
    return commits


def commit_graph(repo_path, limit=MAX_COMMITS):
    """{"commits": [...], "remotes": [...]}: the remote names tell the page which labels are remote branches."""
    done = git_output(repo_path, "log", "--all", "--topo-order", "--max-count=%d" % limit, "--format=" + FIELDS)
    remotes = git_output(repo_path, "remote")
    return {
        "commits": parse_log(done.stdout) if done.returncode == 0 else [],
        "remotes": remotes.stdout.decode("utf-8", "replace").split() if remotes.returncode == 0 else [],
    }
