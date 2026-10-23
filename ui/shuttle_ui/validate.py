"""What the page may ask for. Every value becomes an argument of git-shuttle, never a shell word."""
import re

from .errors import BadRequest

NAME_RE = re.compile(r"^[A-Za-z0-9._/\-]{1,200}$")
HASH_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
TRAILER_RE = re.compile(r"^[A-Za-z0-9\- ]{0,200}$")
MAX_PATHS = 2000


def text(value, field, limit=2000, required=False, single_line=False):
    if value is None or value == "":
        if required:
            raise BadRequest("%s is required" % field)
        return ""
    if not isinstance(value, str):
        raise BadRequest("%s must be text" % field)
    if "\0" in value or len(value) > limit:
        raise BadRequest("%s is not valid" % field)
    if single_line and ("\n" in value or "\r" in value):
        raise BadRequest("%s must be on one line" % field)
    return value


def name(value, field, required=True):
    if value is None or value == "":
        if required:
            raise BadRequest("%s is required" % field)
        return ""
    if not isinstance(value, str) or not NAME_RE.match(value) or value.startswith("-") or ".." in value:
        raise BadRequest("%s is not a valid branch name" % field)
    return value


def display_name(value, field="name"):
    """A name to show: one line of text, 1 to 80 characters, no control characters."""
    if not isinstance(value, str):
        raise BadRequest("%s must be text" % field)
    value = value.strip()
    if not value or len(value) > 80:
        raise BadRequest("%s must be 1 to 80 characters" % field)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise BadRequest("%s must be on one line, without control characters" % field)
    return value


def paths_of(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise BadRequest("paths must be a list")
    return value


def relative_path(value):
    if not isinstance(value, str) or not value or "\0" in value or len(value) > 500:
        raise BadRequest("a path is not valid")
    if value.startswith("/") or value.startswith("-") or any(part == ".." for part in value.split("/")):
        raise BadRequest("paths must stay inside the repository: %r" % value)
    return value


def flag(value):
    """An on/off option: true or false (0 and 1 are accepted); anything else is refused rather than guessed."""
    if value is None or isinstance(value, bool):
        return bool(value)
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise BadRequest("an option must be true or false")


def build_commands(action, params):
    """The list of git-shuttle argument lists an action stands for (run in order, stopping at the first failure)."""
    p = params if isinstance(params, dict) else {}
    from .validate_ops import build  # late: validate_ops imports the helpers of this module
    more = build(action, p)
    if more is not None:
        return more
    if action == "start":
        # the name of the task may come from an add-on that was enabled (git shuttle start --task 4821): the flag is checked here, and
        # again by the command, which knows only the flags that an enabled add-on declared
        addon = p.get("addon")
        args = ["start"]
        if addon is not None:
            from .validate_ops import ADDON_RE, ADDON_FLAG_RE
            if not isinstance(addon, dict) or not isinstance(addon.get("name"), str) or not ADDON_RE.match(addon["name"]) \
                    or not isinstance(addon.get("flag"), str) or not ADDON_FLAG_RE.match(addon["flag"]):
                raise BadRequest("the add-on to start from is not valid")
            value = text(addon.get("value"), "the task", 300, True, True)
            if p.get("name"):
                args.append(text(p.get("name"), "name", 200, True, True))
            args += ["--" + addon["flag"], value]
        else:
            args.append(text(p.get("name"), "name", 200, True, True))
        if flag(p.get("stash")) and flag(p.get("carry")):
            raise BadRequest("choose --stash or --carry, not both")
        if flag(p.get("stash")):
            args.append("--stash")
        if flag(p.get("carry")):
            args.append("--carry")
        return [args]
    if action == "cherry-pick":
        commits = p.get("commits") or []
        if not isinstance(commits, list) or not commits or len(commits) > 100:
            raise BadRequest("choose at least one commit")
        for h in commits:
            if not isinstance(h, str) or not HASH_RE.match(h):
                raise BadRequest("a commit is not valid")
        args = ["cherry-pick"]
        if p.get("strategy"):
            if p.get("strategy") not in ("ours", "theirs"):
                raise BadRequest("strategy must be ours or theirs")
            args += ["--strategy-option", p["strategy"]]
        return [args + list(commits)]
    if action == "branch":
        args = ["branch", name(p.get("name"), "name")]
        if p.get("commit"):
            if not isinstance(p["commit"], str) or not HASH_RE.match(p["commit"]):
                raise BadRequest("a commit is not valid")
            args.append(p["commit"])
        return [args] + ([["push"]] if flag(p.get("push")) else [])
    if action == "switch":
        return [["switch", name(p.get("name"), "name")]]
    if action == "stage":
        paths = [relative_path(x) for x in paths_of(p.get("paths"))]
        if not paths or len(paths) > MAX_PATHS:
            raise BadRequest("name the paths to stage")
        return [["stage", "--"] + paths]
    if action == "unstage":
        paths = [relative_path(x) for x in paths_of(p.get("paths"))]
        if not paths or len(paths) > MAX_PATHS:
            raise BadRequest("name the paths to unstage")
        return [["unstage", "--"] + paths]
    if action == "discard":
        paths = [relative_path(x) for x in paths_of(p.get("paths"))]
        if not paths or len(paths) > MAX_PATHS:
            raise BadRequest("name the paths to discard")
        args = ["discard"]
        if flag(p.get("staged")):
            args.append("--staged")
        if flag(p.get("untracked")):
            args.append("--untracked")
        return [args + ["--"] + paths]
    if action == "push":
        return [["push"] + (["--force-with-lease"] if flag(p.get("force")) else [])]
    if action == "continue":
        return [["continue"]]
    if action == "abort":
        return [["abort"]]
    if action == "ship":
        commands = []
        stage = [relative_path(x) for x in (p.get("stage") or [])]
        if stage:
            commands.append(["stage", "--"] + stage)
        for c in (p.get("commits") or []):
            if not isinstance(c, dict):
                raise BadRequest("a commit is not valid")
            msg = text(c.get("message"), "message", 2000, True)
            paths = [relative_path(x) for x in (c.get("paths") or [])]
            if not paths:
                raise BadRequest("a commit needs its paths")
            commands.append(["commit", "-m", msg, "--"] + paths)
        ship = ["ship"]
        if flag(p.get("pr")):
            ship.append("--pr")
            title = text(p.get("title"), "title", 300, False, True)
            if title:
                ship += ["--title", title]
            body = text(p.get("body"), "body", 60000)
            if body:
                ship += ["--body", body]
            if flag(p.get("draft")):
                ship.append("--draft")
        elif flag(p.get("no_sync")):
            ship.append("--no-sync")
        commands.append(ship)
        return commands
    if action == "release":
        onto = text(p.get("onto"), "onto", 200, True, True)
        if onto != "auto":
            onto = name(onto, "onto")
        args = ["release", "--onto", onto]
        if p.get("from"):
            args += ["--from", name(p.get("from"), "from")]
        if p.get("strategy"):
            if p.get("strategy") not in ("ours", "theirs"):
                raise BadRequest("strategy must be ours or theirs")
            args += ["--strategy-option", p["strategy"]]
        if flag(p.get("push")):
            args.append("--push")
        commits = p.get("commits") or []
        empty, append = flag(p.get("empty")), flag(p.get("append"))
        if empty and append:
            raise BadRequest("a release branch is either made empty or given commits")
        if empty:
            if commits:
                raise BadRequest("an empty release branch has no commits")
            return [args + ["--empty"]]
        if append:
            if onto == "auto":
                raise BadRequest("name the release branch to add commits to")
            args.append("--append")
        if not commits or not isinstance(commits, list):
            raise BadRequest("choose at least one commit")
        for h in commits:
            if not isinstance(h, str) or not HASH_RE.match(h):
                raise BadRequest("a commit is not valid")
            args.append(h)
        return [args]
    if action == "pr":
        args = ["pr"]
        if p.get("base"):
            args += ["--base", name(p.get("base"), "base")]
        title = text(p.get("title"), "title", 300, False, True)
        if title:
            args += ["--title", title]
        body = text(p.get("body"), "body", 60000)
        if body:
            args += ["--body", body]
        if flag(p.get("draft")):
            args.append("--draft")
        return [args]
    if action == "init":
        args = ["init"]
        for key, opt in (("integration", "--integration"), ("release", "--release"), ("base", "--base")):
            if p.get(key):
                args += [opt, name(p[key], key)]
        if p.get("protected"):
            args += ["--protected", " ".join(name(x, "protected") for x in str(p["protected"]).replace(",", " ").split())]
        if "messagePattern" in p:
            args += ["--message-pattern", text(p.get("messagePattern"), "messagePattern", 500, False, True)]
        if "forbidTrailers" in p:
            value = text(p.get("forbidTrailers"), "forbidTrailers", 200, False, True)
            if not TRAILER_RE.match(value):
                raise BadRequest("forbidTrailers is not valid")
            args += ["--forbid-trailers", value]
        if "branchPrefix" in p:
            args += ["--branch-prefix", text(p.get("branchPrefix"), "branchPrefix", 100, False, True)]
        if "releasePattern" in p:
            args += ["--release-pattern", text(p.get("releasePattern"), "releasePattern", 200, False, True)]
        if "upgradeCommand" in p:
            args += ["--upgrade-command", text(p.get("upgradeCommand"), "upgradeCommand", 500, False, True)]
        if flag(p.get("hook")):
            args.append("--hook")
        return [args]
    raise BadRequest("unknown action")
