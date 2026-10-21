# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and the project follows Semantic Versioning.

## [0.1.2] - 2026-10-21

### Added
- `install.sh`: install from the latest release with one line, `curl -fsSL https://github.com/adityaoryza/git-shuttle/raw/main/install.sh | bash`
  (a tag, and where to install, can be chosen). The README opens with it.
- The web page says so when the GitHub CLI (`gh`) is missing: a warning in the Ship panel (the pull request button is disabled) and a message
  on the release button, with what to install and the way around it. `status --porcelain` reports `gh=0|1`, and the message of `pr` says what to do.
- "Don't show this preview again" on the preview of an action that is easy to take back (pull, switch, branch, tag, cherry-pick, stash, push
  and the like). Reset, discard, drop, rewrite, delete and a force push always show it. Settings can turn the previews back on.

### Changed
- Windows with Git for Windows (Git Bash): the web page starts through Git's bash and reads repositories, and `git shuttle ui` uses `python`
  where `python3` is only the Microsoft Store stub. This is experimental: dialogs that ask for a path expect one that starts with `/`. WSL2 is
  still the recommended way on Windows.

### Fixed
- The banner test no longer hard-codes the version.

## [0.1.1] - 2026-10-21

### Fixed
- Stashing from the web UI with "Include new files" left the new files in the working tree: the server runs git with
  `GIT_LITERAL_PATHSPECS=1`, which makes `git stash --include-untracked` skip them. `stash` now turns that variable off for its one git call.
- `make lint` passes with ShellCheck 0.9 (the version on Ubuntu runners): `worktree add` no longer uses `A && B || C`, and SC2119 is disabled.

### Tests and project
- Browser tests wait for the page to settle after a fetch and after resizing a table, and print the page and the server log when a scenario
  crashes. Two scenarios that failed on the CI runners (the cherry-pick menu and repositories with the same name) were removed.

## [0.1.0] - 2026-10-21

First release.

### Command line
- `status`, `commit`, `sync`, `push`, `merge`, `pick`, `hook`, `config`, with `status --porcelain` for programs.
- `init` sets a repository up in one go and proposes what it detects. `ship` commits and merges after one question, or opens a pull
  request with `--pr`. `release` is `pick` where a branch name stands for the commits it brought, with `--onto auto` for a name from
  `shuttle.releasePattern`.
- `start` makes a task branch from the remote integration branch; with `--stash` or `--carry` it also deals with uncommitted changes.
- `switch`, `branch`, `cherry-pick`, `stage`, `unstage`, `discard`, `pr`, `continue`, `abort`, `candidates`.
- Branches: `fetch`, `pull` (fast-forward, rebase or merge, or `--branch` to update another branch without checking it out), `rename`,
  `delete`, `upstream`, `merge-in`, `rebase-on`, `compare`, `sync --merge`.
- Commits: `revert`, `amend`, `tag`, `untag`, `reset`, `switch --detach`, `rewrite` (an interactive rebase from a plan), `drop`, `move`,
  `patch create|apply`, `link`. Rewriting is refused for commits that are on a remote unless `--allow-pushed` is given; a hard reset
  needs the branch name typed.
- Working tree: `stash` (push, list, apply, pop, drop, show), `worktree` (list, add, remove).
- `undo`, `redo` and `journal`: every change git-shuttle makes is recorded in the git directory and can be taken back, when that is safe.
- Every command that changes something prints what it runs, asks first, and honours `--dry-run` and `--yes`.
- Checks before anything changes: protected branches, a detached HEAD, uncommitted changes, a rebase, merge or cherry-pick waiting
  to be finished, commit message rules (`shuttle.messagePattern`, `shuttle.forbidTrailers`), and commits only the local integration
  branch has. A commit-msg hook can apply the message rules to plain `git commit`.
- Exit status: 0 done, 1 refused, 2 stopped half way, 3 declined.

### Web UI (`git shuttle ui`)
- A local server on 127.0.0.1 with a random token, `Host` and `Origin` checks, JSON-only requests and no shell: every action is a
  git-shuttle command, previewed with `--dry-run` before it runs.
- The commit graph with branch, tag and remote labels; the branch picker with an eye on every branch, folder and group, which also
  switches branch; a context menu on commits (cherry-pick, create a branch here, switch, copy).
- Tabs for the flow: **Start** (aware of where you are and of uncommitted changes), **Ship** (one commit per module, test command,
  merge or pull request, with the changed files of each module) and **Release** (pick commits in order, branch name from a pattern).
- A toolbar (undo, redo, pull menu, push, branch, stash, pop, a sync button that does what is next, log, actions, search), an actions
  palette (Ctrl+K) that shows the command line of each action, a shortcut sheet (`?`), and the reason shown for every action that is
  unavailable. A parity test keeps every command of the tool reachable from the page.
- The graph is a table: Branch/Tag, Graph, Message, Author (following `.mailmap`), Date (relative or absolute), SHA, optional Committer and
  Refs; resizable, movable, hideable and sortable, remembered. Branch rows have actions and comparison buttons; commits have the full menu
  (revert, tag, reset, amend, drop, move, interactive rebase, compare, patch, link). Dialogs for the stash, worktrees and the journal.
- A command log with paging, filters, search, day separators, details with redacted output, and re-run for safe actions; the history is
  rotated at 5 MB.
- Adding a repository walks through the folders of your home folder.
- Commit details and diffs: author, message, parents, files as a list or tree in a table whose columns can be resized, sorted,
  hidden and remembered, and the diff with line numbers, side by side and light syntax colours. The working tree, with stage,
  unstage and discard. Draggable splitters between the panes.
- Publish and push from the top bar, with a separate explicit force push (with lease) for a diverged branch.
- Settings per repository: branch fields that suggest existing remote branches, a task prefix, a release name pattern with a preview,
  message rules, a test command, and a display name (names may repeat; the list tells them apart).
- Notifications with a progress bar, stacked and dismissible, with a summary of what a fetch changed; a progress bar under the top
  bar and button spinners while something runs; confirmation dialogs instead of the browser's.
- Light and dark theme (the first visit follows the system), an icon, a banner when the server is older than the page, and a layout
  that does not overflow from 1366 px down to 390 px.
- A terminal log of what the server does (one line per action and problem; `--verbose`, `--quiet`), the browser opened by itself
  (WSL included), and a clean stop on Ctrl-C.
- Python 3.7 or newer, standard library only; the page needs no build step.

### Tests and project
- Suites for the commands (bash), the server (Python), the page logic (Node) and, on request, the browser (`make e2e`, Playwright).
- Continuous integration on Python 3.9 and 3.12 with Node 18 and 22; bash 4.4 and 5.1 and Python 3.9, 3.10 and 3.12 were run locally.

[0.1.2]: https://github.com/adityaoryza/git-shuttle/releases/tag/v0.1.2
[0.1.1]: https://github.com/adityaoryza/git-shuttle/releases/tag/v0.1.1
[0.1.0]: https://github.com/adityaoryza/git-shuttle/releases/tag/v0.1.0
