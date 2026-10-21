"""The commit graph: a read-only `git log` with fixed arguments, returned as plain records for the page to draw."""
import re

from .errors import BadRequest
from .runner import git_output

FIELDS = "%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s"
MAX_COMMITS = 400
MAX_REFS = 500
REF_RE = re.compile(r"^refs/(heads|remotes|tags)/[A-Za-z0-9._/\-]{1,200}$")


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


def branch_list(repo_path):
    """Local and remote branches for the branch picker: [{name, ref, sha, current, upstream}], and the number of tags."""
    done = git_output(repo_path, "for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(HEAD)%1f%(upstream:short)", "refs/heads", "refs/remotes", "refs/tags")
    local, remote, tags = [], [], 0
    for line in done.stdout.decode("utf-8", "replace").split("\n"):
        if not line:
            continue
        ref, sha, head, upstream = (line.split("\x1f") + [""] * 4)[:4]
        if ref.startswith("refs/tags/"):
            tags += 1
        elif ref.startswith("refs/heads/"):
            local.append({"name": ref[11:], "ref": ref, "sha": sha, "current": head == "*", "upstream": upstream})
        elif ref.startswith("refs/remotes/") and not ref.endswith("/HEAD"):
            remote.append({"name": ref[13:], "ref": ref, "sha": sha, "current": False, "upstream": ""})
    return {"local": local, "remote": remote, "tags": tags}


def commit_graph(repo_path, refs=None, limit=MAX_COMMITS):
    """{"commits": [...], "remotes": [...]}: the remote names tell the page which labels are remote branches.

    `refs` limits the graph to those full ref names (plus HEAD, so that where you are is always shown); None means all."""
    if refs is None:
        starts = ["--branches", "--remotes", "--tags", "HEAD"]   # not --all: that would draw the stash
    else:
        if not isinstance(refs, list) or len(refs) > MAX_REFS or not all(isinstance(r, str) and REF_RE.match(r) and ".." not in r for r in refs):
            raise BadRequest("the list of branches to show is not valid")
        starts = list(refs) + ["HEAD"]
    done = git_output(repo_path, "log", "--topo-order", "--max-count=%d" % limit, "--format=" + FIELDS, *starts)
    remotes = git_output(repo_path, "remote")
    return {
        "commits": parse_log(done.stdout) if done.returncode == 0 else [],
        "remotes": remotes.stdout.decode("utf-8", "replace").split() if remotes.returncode == 0 else [],
    }
