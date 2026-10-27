"""Where the commits of the integration branch are on their way to production: read-only `git` with fixed arguments.

A commit that was cherry-picked into the release branch has another hash there: git compares the patches (`git cherry`), the way the
Release tab does, so that it counts as released."""
import re

from .runner import git_output

MAX_OPEN_RELEASES = 5
MAX_PROD = 1500       # the newest commits of the release branch: the graph shows 400 commits, so older ones are never asked about
_PLACEHOLDER = re.compile(r"\{(?:date|yymmdd|n)\}")
_CACHE = {}


def _config(repo_path, key):
    done = git_output(repo_path, "config", "--get", key)
    return done.stdout.decode("utf-8", "replace").strip() if done.returncode == 0 else ""


def _sha(repo_path, ref):
    done = git_output(repo_path, "rev-parse", "--verify", "-q", ref + "^{commit}")
    return done.stdout.decode().strip() if done.returncode == 0 else ""


def _cherry(repo_path, upstream, head, limit=None):
    """[(mark, sha)] of `git cherry`: '+' no equivalent in upstream, '-' there is one."""
    done = git_output(repo_path, "cherry", upstream, head, *([limit] if limit else []))
    rows = [line.split() for line in done.stdout.decode("utf-8", "replace").splitlines()] if done.returncode == 0 else []
    return [(row[0], row[1]) for row in rows if len(row) == 2]


def _open_releases(repo_path, remote, release, pattern):
    """The release branches that are not in the release branch yet (a pull request that is not merged), newest first."""
    glob = _PLACEHOLDER.sub("*", pattern or "release/{date}-v1.{n}")
    prefix = "refs/remotes/%s/" % remote
    done = git_output(repo_path, "for-each-ref", "--sort=-creatordate", "--format=%(refname)", prefix + glob)
    refs = [r for r in done.stdout.decode("utf-8", "replace").split() if r != release]
    out = []
    for ref in refs:
        if git_output(repo_path, "merge-base", "--is-ancestor", ref, release).returncode != 0:
            out.append(ref)
    return out[:MAX_OPEN_RELEASES]


def release_state(repo_path):
    """{"set": bool, "release": sha, "prod": [sha], "staging": [sha], "queued": {sha: release branch}, "equivalent": [sha]}.

    prod: the newest commits that the release branch has.
    staging: in the integration branch, not in the release branch, not in an open release branch.
    queued: in an open release branch (its pull request is not merged yet).
    equivalent: a patch that the release branch already has under another hash (a cherry-pick).
    Nothing is set until the repository has an integration and a release branch."""
    remote = _config(repo_path, "shuttle.remote") or "origin"
    integration_name, release_name = _config(repo_path, "shuttle.integration"), _config(repo_path, "shuttle.release")
    if not integration_name or not release_name:
        return {"set": False}
    integration, release = "refs/remotes/%s/%s" % (remote, integration_name), "refs/remotes/%s/%s" % (remote, release_name)
    integration_sha, release_sha = _sha(repo_path, integration), _sha(repo_path, release)
    if not integration_sha or not release_sha:
        return {"set": False}
    pattern = _config(repo_path, "shuttle.releasePattern")
    opens = _open_releases(repo_path, remote, release, pattern)
    key = (repo_path, integration_sha, release_sha, tuple((ref, _sha(repo_path, ref)) for ref in opens))
    if key in _CACHE:
        return _CACHE[key]
    queued = {}
    for ref in opens:
        for mark, sha in _cherry(repo_path, ref, integration, release):
            if mark == "-":
                queued.setdefault(sha, ref[len("refs/remotes/%s/" % remote):])
    staging, equivalent = [], []
    for mark, sha in _cherry(repo_path, release, integration):
        if mark == "-":
            equivalent.append(sha)
        elif sha not in queued:
            staging.append(sha)
    # a merge commit has no patch of its own: it is in staging as long as the release branch does not have it
    merges = git_output(repo_path, "rev-list", "--merges", "--max-count=%d" % MAX_PROD, release + ".." + integration)
    staging += [sha for sha in (merges.stdout.decode().split() if merges.returncode == 0 else []) if sha not in queued]
    prod = git_output(repo_path, "rev-list", "--max-count=%d" % MAX_PROD, release)
    state = {"set": True, "release": release_sha, "prod": prod.stdout.decode().split() if prod.returncode == 0 else [],
             "staging": staging, "queued": queued, "equivalent": equivalent}
    if len(_CACHE) > 8:
        _CACHE.clear()
    _CACHE[key] = state
    return state
