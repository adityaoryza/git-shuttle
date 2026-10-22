# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and the project follows Semantic Versioning.

## [0.2.0] - 2026-10-22

The first release that has `git shuttle update`, the About dialog and the new Release tab. It also holds what the 0.1.2 tag
was made of (the installer, the GitHub CLI warning, "Don't show this preview again", the Windows work), which `main` had not got.

### Added
- Release: `git shuttle release --onto NEW --empty` makes the release branch with no commit yet, and `--onto NAME --append COMMIT...`
  adds commits to one that exists (both with `--push`). The Release tab of the web UI has a search, "Hide released", Select all (also per
  merge), the next branch name from the pattern in Settings (with a link to change it), a choice between a new branch and one that exists,
  removing a pick, and "Copy release notes" (Markdown by module, for the pull request). The four steps are said at the top. After a release
  the tab clears the picks and says what comes next. `candidates` marks a commit that is in a release branch on its way (made with the
  pattern, not in the release branch yet) with `~` and the branch, and the tab shows "in <branch>" instead of leaving it pickable.
- `git shuttle update [--check] [--to TAG]`: look for a newer release and install it. The release is downloaded next to the installed copy,
  checked (it has to run and say the version asked for) and swapped in only then; a failure leaves the installed copy as it was. A git
  checkout or a copy put somewhere by hand is not touched. The About dialog of the web UI has a "Check for updates" button (also in the
  Actions palette); nothing asks GitHub until it is clicked. The web UI API is now level 5.
- Web UI: the logo and name in the top bar, a credit line at the bottom (version, author) and an About dialog (author links,
  project links, licence, the version of the server). It is also in the Actions palette, and the first-run screen shows the logo.
  The page still loads nothing from the internet: a link opens in a new tab only when it is clicked.

### Fixed
- Web UI server: the body of a refused POST (no token, wrong content type) is read and dropped. Left unread it could be taken for the
  start of the next request on a kept-alive connection, and a connection closed with unread data could be reset before the browser had
  read the answer.
- Web UI: a dialog without a field (About, for one) now moves the focus to its first button when it opens, even when the page does not
  render again afterwards.

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

[0.1.1]: https://github.com/adityaoryza/git-shuttle/releases/tag/v0.1.1
[0.1.0]: https://github.com/adityaoryza/git-shuttle/releases/tag/v0.1.0
