"""The actions on branches, commits, the stash and worktrees: what the page may ask for, as git-shuttle argument lists."""
import re

from .errors import BadRequest
from .validate import HASH_RE, flag, name, text

PLAN_ACTIONS = ("pick", "reword", "squash", "fixup", "drop")
MAX_PLAN = 200
MAX_PATH = 500


def commit(value, field="commit"):
    if not isinstance(value, str) or not HASH_RE.match(value):
        raise BadRequest("%s is not a valid commit" % field)
    return value


def commitish(value, field):
    """A commit id, or the name of a branch or tag."""
    if isinstance(value, str) and HASH_RE.match(value):
        return value
    return name(value, field)


def folder(value, field="path"):
    if not isinstance(value, str) or not value or "\0" in value or "\n" in value or len(value) > MAX_PATH or not value.startswith("/"):
        raise BadRequest("%s must be an absolute path" % field)
    if any(part == ".." for part in value.split("/")):
        raise BadRequest("%s must not contain '..'" % field)
    return value


def one_of(value, options, field):
    if value not in options:
        raise BadRequest("%s must be one of: %s" % (field, ", ".join(o for o in options if o)))
    return value


TARGET_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
MODULES_RE = re.compile(r"^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$")
HOST_RE = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.:-]*$")


def deploy_target(value):
    if not isinstance(value, str) or not TARGET_RE.match(value):
        raise BadRequest("the target name is not valid: lowercase letters, digits, - and _")
    return value


def deploy_args(action, p):
    """deploy TARGET [--modules A,B] [--confirm TARGET], and the setting up and removing of a target. Everything is checked here as well
    as by the command: nothing from the page reaches ssh, a shell or a config key unchecked."""
    target = deploy_target(p.get("target"))
    if action == "deploy-forget":
        return ["deploy", "--forget", target]
    if action == "deploy-check":
        return ["deploy", target, "--check"]
    if action == "deploy":
        args = ["deploy", target]
        if p.get("modules"):
            if not isinstance(p["modules"], str) or not MODULES_RE.match(p["modules"]) or len(p["modules"]) > 2000:
                raise BadRequest("the modules are not valid: names separated by commas")
            args += ["--modules", p["modules"]]
        if p.get("confirm"):
            args += ["--confirm", deploy_target(p["confirm"])]
        return args
    host = p.get("host")
    if not isinstance(host, str) or not HOST_RE.match(host) or len(host) > 255:
        raise BadRequest("the server is not valid: user@host, or an alias of ~/.ssh/config")
    command = text(p.get("command"), "command", 500, True, True)
    if command.startswith("-"):
        raise BadRequest("the command cannot start with a dash")
    args = ["deploy", "--setup", target, "--host", host, "--command", command, "--branch", name(p.get("branch"), "branch"),
            "--sudo", one_of(p.get("sudo") or "none", ("none", "ask"), "sudo"),
            "--detector", one_of(p.get("detector") or "none", ("none", "odoo"), "detector"),
            "--require-name" if flag(p.get("require_name")) else "--no-require-name"]
    if p.get("port") not in (None, ""):
        port = str(p["port"])
        if not port.isdigit() or not 1 <= int(port) <= 65535:
            raise BadRequest("the port is not valid")
        args += ["--port", port]
    return args


def stash_index(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9999:
        raise BadRequest("the stash number is not valid")
    return str(value)


def build(action, p):
    """The argument lists for one of these actions, or None when the action is not one of them."""
    if action == "pull":
        args = ["pull"]
        mode = one_of(p.get("mode") or "ff", ("ff", "rebase", "merge"), "mode")
        args.append({"ff": "--ff-only", "rebase": "--rebase", "merge": "--merge"}[mode])
        if p.get("branch"):
            args += ["--branch", name(p["branch"], "branch")]
        return [args]
    if action == "sync":
        args = ["sync"]
        if p.get("onto"):
            args += ["--onto", name(p["onto"], "onto")]
        if flag(p.get("merge")):
            args.append("--merge")
        return [args]
    if action == "rename":
        args = ["rename", name(p.get("old"), "old"), name(p.get("new"), "new")]
        return [args + (["--remote"] if flag(p.get("remote")) else [])]
    if action == "delete":
        if flag(p.get("remote")) and flag(p.get("force")):
            raise BadRequest("--force is for a local branch")
        args = ["delete"] + (["--remote"] if flag(p.get("remote")) else []) + [name(p.get("name"), "name")]
        return [args + (["--force"] if flag(p.get("force")) else [])]
    if action == "upstream":
        args = ["upstream", name(p.get("name"), "name")]
        if flag(p.get("unset")) == bool(p.get("set")):
            raise BadRequest("choose a remote branch to follow, or remove the upstream")
        return [args + (["--unset"] if flag(p.get("unset")) else ["--set", name(p["set"], "set")])]
    if action == "merge-in":
        mode = one_of(p.get("mode") or "", ("", "ff", "no-ff", "ff-only"), "mode")
        return [["merge-in", name(p.get("name"), "name")] + (["--" + mode] if mode else [])]
    if action == "rebase-on":
        return [["rebase-on", name(p.get("name"), "name")]]
    if action in ("undo", "redo"):
        return [[action]]
    if action == "revert":
        return [["revert", commit(p.get("commit"))]]
    if action == "amend":
        args = ["amend", "-m", text(p.get("message"), "message", 60000, True)]
        return [args + (["--allow-pushed"] if flag(p.get("allow_pushed")) else [])]
    if action == "tag":
        args = ["tag", name(p.get("name"), "name")]
        if p.get("commit"):
            args.append(commit(p["commit"]))
        if p.get("message"):
            args += ["-m", text(p["message"], "message", 5000)]
        return [args + (["--push"] if flag(p.get("push")) else [])]
    if action == "untag":
        return [["untag", name(p.get("name"), "name")] + (["--remote"] if flag(p.get("remote")) else [])]
    if action == "reset":
        mode = one_of(p.get("mode"), ("soft", "mixed", "hard"), "mode")
        args = ["reset", "--" + mode, commit(p.get("commit"))]
        if mode == "hard":
            args += ["--confirm-branch", name(p.get("confirm_branch"), "confirm_branch")]
        return [args]
    if action == "stash":
        sub = one_of(p.get("sub") or "push", ("push", "apply", "pop", "drop"), "sub")
        if sub == "push":
            args = ["stash", "push"]
            if p.get("message"):
                args += ["-m", text(p["message"], "message", 500, False, True)]
            return [args + (["--include-untracked"] if flag(p.get("untracked")) else [])]
        return [["stash", sub, stash_index(p.get("index"))]]
    if action == "worktree-add":
        args = ["worktree", "add", folder(p.get("path")), name(p.get("branch"), "branch")]
        if p.get("new_from"):
            args += ["--new", commitish(p["new_from"], "new_from")]
        return [args]
    if action == "worktree-remove":
        return [["worktree", "remove", folder(p.get("path"))] + (["--force"] if flag(p.get("force")) else [])]
    if action == "patch-apply":
        return [["patch", "apply", folder(p.get("path"))]]
    if action == "switch-detach":
        return [["switch", "--detach", commit(p.get("commit"))]]
    if action == "drop":
        return [["drop", commit(p.get("commit"))] + (["--allow-pushed"] if flag(p.get("allow_pushed")) else [])]
    if action == "move":
        return [["move", commit(p.get("commit")), one_of(p.get("way"), ("up", "down"), "way")] + (["--allow-pushed"] if flag(p.get("allow_pushed")) else [])]
    if action == "rewrite":
        plan = p.get("plan")
        if not isinstance(plan, list) or not plan or len(plan) > MAX_PLAN:
            raise BadRequest("the plan needs at least one commit")
        args = ["rewrite", commit(p.get("base"), "base")]
        messages = []
        for item in plan:
            if not isinstance(item, dict):
                raise BadRequest("a step of the plan is not valid")
            sha = commit(item.get("commit"))
            step = one_of(item.get("action"), PLAN_ACTIONS, "action")
            args.append("%s:%s" % (step, sha))
            if step == "reword" or item.get("message"):
                messages += ["--message", "%s=%s" % (sha, text(item.get("message"), "message", 60000, True))]
        return [args + messages + (["--allow-pushed"] if flag(p.get("allow_pushed")) else [])]
    if action in ("deploy", "deploy-check", "deploy-setup", "deploy-forget"):
        return [deploy_args(action, p)]
    return None
