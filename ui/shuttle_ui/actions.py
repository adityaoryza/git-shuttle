"""Every action of the page, and which `git shuttle` command it stands for.

The page builds its menus, its toolbar and its command palette from CATALOG (GET /api/actions); the palette shows the equivalent
command line of each. COMMANDS says where in the page every command of the tool can be reached: a test fails when a command has no
entry, so that nothing the tool can do is available only in a terminal.
"""

# id: what the page sends as the action; cli: the command line it stands for (the palette shows it); where: how to reach it.
CATALOG = [
    # keeping up to date
    {"id": "fetch", "label": "Fetch", "group": "Sync", "cli": "git shuttle fetch --prune", "where": "toolbar Fetch", "key": "Shift+F"},
    {"id": "pull", "label": "Pull (fast-forward)", "group": "Sync", "cli": "git shuttle pull --ff-only", "where": "toolbar Pull menu"},
    {"id": "pull-rebase", "label": "Pull and rebase", "group": "Sync", "cli": "git shuttle pull --rebase", "where": "toolbar Pull menu"},
    {"id": "pull-merge", "label": "Pull and merge", "group": "Sync", "cli": "git shuttle pull --merge", "where": "toolbar Pull menu"},
    {"id": "update-branch", "label": "Update a branch without checking it out", "group": "Sync", "cli": "git shuttle pull --branch NAME", "where": "branch list, row button"},
    {"id": "sync", "label": "Update from the integration branch (rebase)", "group": "Sync", "cli": "git shuttle sync", "where": "toolbar Pull menu, branch menu"},
    {"id": "sync-merge", "label": "Merge the integration branch into this branch", "group": "Sync", "cli": "git shuttle sync --merge", "where": "toolbar Pull menu, branch menu"},
    {"id": "push", "label": "Push", "group": "Sync", "cli": "git shuttle push", "where": "toolbar Push", "key": "Shift+P"},
    {"id": "push-force", "label": "Force push (with lease)", "group": "Sync", "cli": "git shuttle push --force-with-lease", "where": "toolbar Push, when diverged"},
    # branches
    {"id": "start", "label": "Start a task", "group": "Branch", "cli": "git shuttle start NAME", "where": "side panel, Start"},
    {"id": "switch", "label": "Switch branch", "group": "Branch", "cli": "git shuttle switch BRANCH", "where": "branch list, graph menu"},
    {"id": "branch", "label": "New branch here", "group": "Branch", "cli": "git shuttle branch NAME [COMMIT]", "where": "toolbar Branch, graph menu", "key": "B"},
    {"id": "rename", "label": "Rename branch", "group": "Branch", "cli": "git shuttle rename OLD NEW [--remote]", "where": "branch menu"},
    {"id": "delete", "label": "Delete branch", "group": "Branch", "cli": "git shuttle delete BRANCH [--force]", "where": "branch menu"},
    {"id": "delete-remote", "label": "Delete branch on the remote", "group": "Branch", "cli": "git shuttle delete --remote BRANCH", "where": "branch menu"},
    {"id": "upstream", "label": "Set or remove the upstream", "group": "Branch", "cli": "git shuttle upstream BRANCH --set R/B | --unset", "where": "branch menu"},
    {"id": "merge-in", "label": "Merge a branch into this one", "group": "Branch", "cli": "git shuttle merge-in BRANCH", "where": "branch menu"},
    {"id": "rebase-on", "label": "Rebase this branch onto another", "group": "Branch", "cli": "git shuttle rebase-on BRANCH", "where": "branch menu"},
    {"id": "compare", "label": "Compare", "group": "Branch", "cli": "git shuttle compare A [B]", "where": "branch menu, graph menu", "key": "C"},
    # commits
    {"id": "cherry-pick", "label": "Cherry-pick", "group": "Commit", "cli": "git shuttle cherry-pick COMMIT...", "where": "graph menu"},
    {"id": "revert", "label": "Revert commit", "group": "Commit", "cli": "git shuttle revert COMMIT", "where": "graph menu"},
    {"id": "amend", "label": "Edit the message of the last commit", "group": "Commit", "cli": "git shuttle amend -m MESSAGE", "where": "graph menu"},
    {"id": "tag", "label": "Create tag", "group": "Commit", "cli": "git shuttle tag NAME [COMMIT] [-m MESSAGE]", "where": "graph menu"},
    {"id": "untag", "label": "Delete tag", "group": "Commit", "cli": "git shuttle untag NAME [--remote]", "where": "graph menu on a tag"},
    {"id": "reset", "label": "Reset the branch to a commit", "group": "Commit", "cli": "git shuttle reset --soft|--mixed|--hard COMMIT", "where": "graph menu"},
    {"id": "switch-detach", "label": "Check out the commit (detached)", "group": "Commit", "cli": "git shuttle switch --detach COMMIT", "where": "graph menu, double click"},
    {"id": "drop", "label": "Drop commit", "group": "Commit", "cli": "git shuttle drop COMMIT", "where": "graph menu"},
    {"id": "move", "label": "Move commit up or down", "group": "Commit", "cli": "git shuttle move COMMIT up|down", "where": "graph menu"},
    {"id": "rewrite", "label": "Interactive rebase", "group": "Commit", "cli": "git shuttle rewrite BASE ACTION:COMMIT...", "where": "graph menu"},
    {"id": "patch-create", "label": "Create a patch", "group": "Commit", "cli": "git shuttle patch create COMMIT", "where": "graph menu"},
    {"id": "patch-apply", "label": "Apply a patch", "group": "Commit", "cli": "git shuttle patch apply FILE", "where": "toolbar Actions"},
    {"id": "link", "label": "Copy the link of a commit", "group": "Commit", "cli": "git shuttle link COMMIT", "where": "graph menu"},
    # working tree
    {"id": "stage", "label": "Stage", "group": "Changes", "cli": "git shuttle stage -- PATH...", "where": "changes list"},
    {"id": "unstage", "label": "Unstage", "group": "Changes", "cli": "git shuttle unstage -- PATH...", "where": "changes list"},
    {"id": "discard", "label": "Discard changes", "group": "Changes", "cli": "git shuttle discard -- PATH...", "where": "changes list"},
    {"id": "stash", "label": "Stash changes", "group": "Changes", "cli": "git shuttle stash [-m MESSAGE] [-u]", "where": "toolbar Stash", "key": "S"},
    {"id": "stash-pop", "label": "Pop the newest stash", "group": "Changes", "cli": "git shuttle stash pop N", "where": "toolbar Pop, stash list", "key": "Shift+S"},
    {"id": "stash-list", "label": "Stashes", "group": "Changes", "cli": "git shuttle stash list | apply N | drop N | show N", "where": "toolbar Actions, stash list"},
    # worktrees
    {"id": "worktree-add", "label": "Add a worktree", "group": "Worktree", "cli": "git shuttle worktree add PATH BRANCH", "where": "toolbar Actions, branch menu"},
    {"id": "addons", "label": "Add-ons", "group": "App", "cli": "git shuttle addon list", "where": "toolbar Actions, Add-ons dialog"},
    {"id": "addon-enable", "label": "Enable an add-on", "group": "App", "cli": "git shuttle addon enable NAME", "where": "Add-ons dialog"},
    {"id": "task-bind", "label": "Link a branch to a task", "group": "Branch", "cli": "git shuttle trace bind TASK", "where": "Tasks dialog"},
    {"id": "addon-report", "label": "Turn the Customer report of an add-on on or off", "group": "App", "cli": "git shuttle addon report NAME on|off", "where": "Add-ons dialog"},
    {"id": "task-report", "label": "Add the pull request and commits to the Customer report", "group": "Branch", "cli": "git shuttle trace report", "where": "Tasks dialog"},
    {"id": "task-unbind", "label": "Unlink a branch from its task", "group": "Branch", "cli": "git shuttle trace unbind", "where": "Tasks dialog"},
    {"id": "addon-install", "label": "Install an add-on", "group": "App", "cli": "git shuttle addon install NAME", "where": "Add-ons dialog"},
    {"id": "addon-uninstall", "label": "Remove an installed add-on", "group": "App", "cli": "git shuttle addon uninstall NAME", "where": "Add-ons dialog"},
    {"id": "tasks", "label": "Tasks", "group": "App", "cli": "git shuttle trace list | show TASK", "where": "toolbar Tasks, Start tab, task cards"},
    {"id": "addon-disable", "label": "Disable an add-on", "group": "App", "cli": "git shuttle addon disable NAME", "where": "Add-ons dialog"},
    {"id": "worktree-list", "label": "Worktrees", "group": "Worktree", "cli": "git shuttle worktree list | remove PATH", "where": "toolbar Actions"},
    # finishing work
    {"id": "ship", "label": "Ship", "group": "Flow", "cli": "git shuttle ship", "where": "side panel, Ship"},
    {"id": "release", "label": "Release", "group": "Flow", "cli": "git shuttle release --onto NEW BRANCH...", "where": "side panel, Release"},
    {"id": "pr", "label": "Open a pull request", "group": "Flow", "cli": "git shuttle pr", "where": "side panel, Ship and Release"},
    {"id": "deploy", "label": "Deploy to a server", "group": "Flow", "cli": "git shuttle deploy TARGET [--modules A,B]", "where": "side panel, Deploy"},
    {"id": "deploy-check", "label": "Test the connection to a server", "group": "Flow", "cli": "git shuttle deploy TARGET --check", "where": "side panel, Deploy"},
    {"id": "deploy-setup", "label": "Set up a deploy target", "group": "Flow", "cli": "git shuttle deploy --setup NAME", "where": "side panel, Deploy"},
    {"id": "deploy-forget", "label": "Remove a deploy target", "group": "Flow", "cli": "git shuttle deploy --forget NAME", "where": "side panel, Deploy"},
    {"id": "continue", "label": "Continue", "group": "Flow", "cli": "git shuttle continue", "where": "banner while an operation waits"},
    {"id": "abort", "label": "Abort", "group": "Flow", "cli": "git shuttle abort", "where": "banner while an operation waits"},
    {"id": "resolve", "label": "Keep one side of a conflict", "group": "Flow", "cli": "git shuttle resolve --ours|--theirs -- PATH...", "where": "banner while an operation waits, next to each file"},
    {"id": "undo", "label": "Undo", "group": "Flow", "cli": "git shuttle undo", "where": "toolbar Undo", "key": "Ctrl+Z"},
    {"id": "redo", "label": "Redo", "group": "Flow", "cli": "git shuttle redo", "where": "toolbar Redo", "key": "Ctrl+Shift+Z"},
    {"id": "journal", "label": "What was changed here", "group": "Flow", "cli": "git shuttle journal", "where": "toolbar Undo menu"},
    # the page itself
    {"id": "log", "label": "Command log", "group": "App", "cli": "", "where": "toolbar Log", "key": "L"},
    {"id": "settings", "label": "Settings", "group": "App", "cli": "git shuttle init", "where": "top bar Settings"},
    {"id": "add-repo", "label": "Add a repository", "group": "App", "cli": "", "where": "top bar Add"},
    {"id": "shortcuts", "label": "Keyboard shortcuts", "group": "App", "cli": "", "where": "?", "key": "?"},
    {"id": "about", "label": "About git-shuttle", "group": "App", "cli": "", "where": "top bar logo, footer"},
    {"id": "update", "label": "Check for updates", "group": "App", "cli": "git shuttle update --check", "where": "About dialog"},
]

# Every command of the tool and where the page offers it (ids of CATALOG, or a sentence for what is not an action).
COMMANDS = {
    "status": ["the top bar and the side panel always show it"],
    "init": ["settings"],
    "hook": ["settings"],
    "config": ["settings"],
    "check-message": ["the commit box checks the message while you type"],
    "candidates": ["the Release tab lists them"],
    "commit": ["ship"],
    "ship": ["ship"],
    "release": ["release"],
    "start": ["start"],
    "switch": ["switch", "switch-detach"],
    "branch": ["branch"],
    "cherry-pick": ["cherry-pick"],
    "pick": ["cherry-pick"],
    "pr": ["pr"],
    "deploy": ["deploy", "deploy-check", "deploy-setup", "deploy-forget"],
    "merge": ["ship"],
    "sync": ["sync", "sync-merge"],
    "push": ["push", "push-force"],
    "continue": ["continue"],
    "abort": ["abort"],
    "resolve": ["resolve"],
    "conflicts": ["resolve"],
    "undo": ["undo"],
    "redo": ["redo"],
    "journal": ["journal"],
    "fetch": ["fetch"],
    "pull": ["pull", "pull-rebase", "pull-merge", "update-branch"],
    "rename": ["rename"],
    "delete": ["delete", "delete-remote"],
    "upstream": ["upstream"],
    "merge-in": ["merge-in"],
    "rebase-on": ["rebase-on"],
    "compare": ["compare"],
    "revert": ["revert"],
    "amend": ["amend"],
    "tag": ["tag"],
    "untag": ["untag"],
    "reset": ["reset"],
    "link": ["link"],
    "rewrite": ["rewrite"],
    "drop": ["drop"],
    "move": ["move"],
    "stash": ["stash", "stash-pop", "stash-list"],
    "worktree": ["worktree-add", "worktree-list"],
    "addon": ["addons", "addon-enable", "addon-disable", "addon-install", "addon-uninstall", "addon-report"],
    "trace": ["tasks", "task-bind", "task-unbind", "task-report"],
    "patch": ["patch-create", "patch-apply"],
    "stage": ["stage"],
    "unstage": ["unstage"],
    "discard": ["discard"],
    "ui": ["this page is the ui command"],
    "update": ["update"],
    "help": ["the shortcuts sheet"],
    "version": ["the version is shown by the server, GET /api/version"],
}

# What the log may offer to run again (the same preview and confirmation come first): never a force, a rewrite or a loss of work.
RERUN_ACTIONS = frozenset(["pull", "push", "stage", "unstage", "switch", "switch-detach"])


def rerunnable(action, params):
    params = params if isinstance(params, dict) else {}
    if action not in RERUN_ACTIONS:
        return False
    if action == "push":
        return not params.get("force")
    if action == "pull":
        return (params.get("mode") or "ff") == "ff"
    return True


def catalog():
    return CATALOG
