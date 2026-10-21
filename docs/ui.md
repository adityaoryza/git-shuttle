# The web UI

`git shuttle ui` starts a small server on `127.0.0.1` and opens the page. It prints a link with a random token; keep it private.

```bash
git shuttle ui [--port N] [--no-open] [--repo PATH]...
```

## What you see

- **Toolbar** under the top bar: Undo, Redo, Pull (with a menu: fast-forward, rebase, merge, update from the integration branch, merge the
  integration branch into this branch, fetch), Push or Publish (a diverged branch asks for the force in its own dialog), Branch, Stash, Pop,
  a Sync button that does what is next (publish, pull, rebase, push, or update from the integration branch), Log, Actions (the palette) and a
  search box for the commits. Every button shows its shortcut, and when it is unavailable, the reason: the same refusals as the command
  line, shown before you ask. When the branch is behind the integration branch, the top bar says so and offers the update.
- **Actions palette** (Ctrl+K): every action of the page by name, with the `git shuttle` command it stands for. Enter runs it after a
  preview. An action that is about a branch or a commit says where to choose one. **Shortcuts** (press `?`): Ctrl+K palette, Ctrl+F search,
  Shift+F fetch, Shift+P push, B new branch, S stash, Shift+S pop, L log, Ctrl+Z undo, Ctrl+Shift+Z redo; plain keys are ignored while you type.
- **The graph is a table**: Branch/Tag, Graph, Message, Author, Date, SHA, and optionally Committer and Refs. Drag a column edge to
  resize, double click to fit, arrow keys on a focused edge; drag a header (or Alt+Left/Right on it) to move it; the gear shows or hides
  columns, chooses relative or absolute dates and shows e-mail addresses, and Reset restores the default. Date and Author sort; the graph
  lines are hidden while sorted or searched, because the order is no longer the history, and the page says so. Names follow the repository's
  `.mailmap` (git's `%aN`), so one person who committed under two names is one author. A narrow window drops Author, then SHA, then Date,
  never the message or the graph. A double click on a row checks out what it stands for, after a preview.
- **Branch list rows** (the branch picker): ↑N and ↓N are buttons that open a comparison with the upstream; the `⋯` button (or right
  click) opens the menu of the branch: switch, update without checking it out (a fast-forward), pull, rebase, merge, rename, set or remove the
  upstream, compare, add a worktree, delete.
- **Command log** (L): everything run from this page, newest first, loaded a page at a time while you scroll, with filters for repository,
  action, result and period (remembered, except the text), a search (`/`), day separators, the commands and the output of each entry
  (credentials replaced), copy, and **Run again** for the safe actions only (never a force, a rewrite or a loss of work). Clear log asks first.
- **Add a repository**: walk through the folders of your home folder (the server lists names only, nothing outside it) or type a path.
  A folder that is a git repository is marked.

- **Top bar: the current branch.** Click it for the branch picker: filter, switch (a remote-only branch gets a local copy), and an
  eye on each branch, on each folder (the part of the name before the first `/`, such as `19.0-feature/`) and on the Local and Remote
  groups, to hide them from the graph. Groups and folders collapse; searching opens them. The choice is kept per repository in the
  browser. Where you are is always drawn, even when hidden.
- **Right-click a commit** (menu key or Shift+F10 on a focused row also work): cherry-pick, revert, create a branch or a tag here,
  delete a tag, reset (soft, mixed, or hard with the branch name typed), check out the commit, edit the message of the last commit, drop,
  move up or down, interactive rebase (a dialog: keep, reword, squash, fixup or drop each commit, and reorder them), compare, create a patch
  (copy it or save it as a file), copy the link, copy the SHA or the message. Everything opens the dry run first; an entry that cannot work
  is greyed out with the reason, and rewriting history is refused for commits that are on a remote.
- **Left: the commit graph** of all branches, newest first. Local branches are blue (the current one filled), remote branches
  and tags are marked, and a dashed row on top stands for the uncommitted changes.
- **Click a commit** (or Enter on a focused row): the details open under the graph: header (id, author, dates, refs, parents as
  links), the whole message, the changed files (list or tree, filter, status letters, +/− counts) and the diff of the picked file
  (line numbers on both sides, hunks, colours, wrap, side by side, light syntax colours). `j`/`k` or the arrows change file, `Esc`
  closes, the handle resizes (remembered). The dashed *working tree* row shows the staged, not staged and untracked files the same way. The Ship tab lists the files of each
  module (collapsible, with status letters and counts) and a click on one opens this panel on its diff.
- **Right: what to do next.** Three tabs, opened on the one that fits (on the integration branch: Start; with changes or
  unshipped commits: Ship).
- **Start**: the task name becomes a branch name (shown as you type), cut from the remote integration branch.
- **Ship**: one commit per top-level folder of the changed files, ordered by you; messages are checked against
  `shuttle.messagePattern` and `shuttle.forbidTrailers` while you type. The test command from `shuttle.upgradeCommand` is shown
  with `{modules}` filled in; the page never runs it, and Run stays locked until you tick "I tested it". Then merge directly or
  open a pull request.
- **Release**: the branches merged since the last release with their commits; tick, reorder, name, run. Then open the pull
  request to the release branch.
- A **conflict** replaces the tabs' result with the conflicting files and Continue / Abort.

Every button is **Preview, then Run**. A preview is valid for exactly the values on screen; change one and it has to be made
again. Settings (the `shuttle.*` values: base, integration and release branch, prefix, rules, test command) are edited in a dialog and saved with `git shuttle init`; the branch fields suggest the branches that exist.

**Rename.** Settings starts with the display name of the repository (it is saved on its own: `git shuttle init` runs only when a
setting changed). Names need not be unique; when two repositories share one, the list shows `name — parent/folder`, and the path is
always the tooltip.

**Server and page of different ages.** `GET /api/version` returns `{version, api}`. The page needs `api` of at least the level it was
written for (`REQUIRED_API` in `js/version.js`, `API_LEVEL` in `shuttle_ui/__init__.py`; a test keeps the two equal). When the route is
missing (404 "not found") or the level is lower, the page shows a banner asking to restart the server, and an API "not found" is reported
with the same sentence. Raise both numbers whenever the page starts to need a route a running server may not have.

**Theme and icon.** The top bar has a toggle between light and dark. The first visit follows `prefers-color-scheme` and saves nothing; a
click saves the choice in `localStorage`, and a tiny external script (`js/theme-init.js`) puts it on `<html data-theme>` before the styles are
used, because the content security policy allows no inline script. The icon is `favicon.svg` (a blue rounded square, so it
reads on light and dark tab bars), `favicon-32.png`, `apple-touch-icon.png` and `favicon.ico` (also answered at `/favicon.ico`).

State kept on your machine, in `~/.config/git-shuttle/` (mode 700): the registered repositories (`repos.json`) and what was run
(`history.jsonl`, rotated at 5 MB into `history.1.jsonl`; each entry has a stable id, the commands and output with credentials replaced,
the exit status and the duration). The undo journal is in the git directory of each repository.

## API

`GET /api/version`, `repos`, `repos/<id>/status|branches|graph|worktree|stashes|stashes/<n>|worktrees|journal`, `commits/<sha>` (and
`/link`, `/patch`), `POST repos/<id>/preview|run|compare|fetch`, `GET history?before=&limit=&repo=&action=&result=&q=&since=`, `POST history/clear`,
`GET actions` (the catalog: id, label, group and command line of every action), `GET browse?path=`. An action is a name and parameters
(`shuttle_ui/validate.py` and `validate_ops.py`); every value is validated and becomes an argument of `git shuttle`, never a shell word.

**Everything the tool can do has a place in the page.** `shuttle_ui/actions.py` maps every `git shuttle` command to the actions of the page;
a test fails when a command has none, or when an action has no behaviour in `static/js/ops.js`.

## Security model

The server can run git-shuttle in your repositories, so a website you visit must not be able to drive it.

| Threat | Defence |
|---|---|
| another machine on the network | the server listens on `127.0.0.1` only |
| a website calling `localhost` | every API call needs the token in a header; the page reads it from the URL fragment (never sent to a server, never in a log), removes it from the address bar and keeps it for that tab only (`sessionStorage`); `Origin` must be this server |
| DNS rebinding | the `Host` header must be this server's own address |
| a request forged without a preflight | a POST must be `application/json`; a refused body closes the connection |
| shell injection | nothing goes through a shell; every value is validated and passed as an argument; branch names and paths cannot start with `-` or leave the repository; an on/off option must be `true` or `false` |
| option injection into git | commit ids are hex, paths come after `--`, `GIT_LITERAL_PATHSPECS=1` makes every path a name and not a pattern, and the remote name taken from the repository's configuration is checked like a branch name |
| acting on any directory | only repositories registered by the user |
| a repository that configures a program to run | diff and commit views pass `--no-ext-diff --no-textconv`, and every read-only git call runs with `core.fsmonitor=false`; `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_EXTERNAL_DIFF` and similar variables of the server's own environment are not passed on. Register only repositories you trust: git hooks of a repository still run when git-shuttle commits in it |
| script injection into the page | `Content-Security-Policy: script-src 'self'; style-src 'self'`; commit messages, names and paths are inserted as text; no external resource |
| reading other files | only files under `static/` with a known extension (html, js, css, svg, png, ico) are served; the resolved path must stay inside it |
| huge output | diffs are cut at 5000 lines or 300 KB; job output at 256 KiB; untracked files over about 1.2 MB are not read; symbolic links are not followed; a commit message over 100 000 characters is cut; request bodies are limited to 1 MiB |
| a client that stops sending | a connection that is silent for 30 seconds is closed |
| unbounded growth | the history file is rotated past 5 MB (the old one is kept once); only the last 50 finished jobs are kept in memory; a page of the log is at most 200 entries |
| credentials in the log | commands and output are redacted (URLs with a user, tokens, passwords, authorization headers) before they are written |
| listing folders | only folders inside your home folder, names only, symbolic links that leave it are not followed |
| two actions at once | one job per repository |
| secrets in the terminal | the log never prints the token, request bodies, query strings, commit messages or file contents; control characters in what it prints are replaced |

Not covered: other programs running as you can read `~/.config/git-shuttle` (mode 700) and connect to the port, but they need the token.

## Front end

Plain ES modules and one CSS file; no build step and no Node needed to run it. The components are Preact with htm
(`static/vendor/`, one 13 KB file; see THIRD_PARTY_NOTICES.md). The look follows the shadcn/ui design tokens
(neutral zinc palette, 6 px radius, light and dark by the system setting) written as plain CSS.
