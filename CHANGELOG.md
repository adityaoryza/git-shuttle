# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Web UI: click a commit (or the working tree) to read it: header, full message, changed files as a list or a tree with a filter,
  and the diff of each file (line numbers, wrap, side by side, light syntax colours, binary / large / truncated messages).
  Read-only endpoints: `GET /api/repos/<id>/commits/<sha>`, `GET /api/repos/<id>/worktree`, `POST /api/repos/<id>/diff`.
- Web UI: rename a repository (a display name; duplicates allowed and told apart by their folder), and a theme button
  (system, light, dark) applied before the first paint.
- Web UI: an icon (SVG, PNG, ICO), also served at `/favicon.ico`.
- Web UI: the Ship tab lists the changed files of each module (collapsible; status, +/−) and opens their diff in the bottom panel.
- Web UI: `GET /api/version` and a banner when the server is older than the page (a bare "not found" now says the same).

### Fixed
- Web UI: nothing makes the page wider than the window any more (the top bar wraps, grid children can shrink, a graph row shows at most
  four labels and "+N"); checked at 1824×955, 1366×768, 1024×700, 800×700 and 390×800.

## [0.1.0] - 2026-10-21

### Added
- `git shuttle status`, `commit`, `sync`, `push`, `merge`, `pick`, `hook` and `config`.
- `init`: sets a repository up in one go, proposing what it detects. `ship`: commit and merge after one question
  (or open a pull request with `--pr`). `release`: `pick` where a branch name stands for the commits it brought, with
  `--onto auto` for a name from `shuttle.releasePattern`.
- `start`, `switch`, `branch`, `cherry-pick`, `stage`, `pr`, `continue`, `abort`, `candidates`, and `status --porcelain` (for programs).
- `git shuttle ui`: a local web UI (127.0.0.1 only, token, Host and Origin checks, no shell): the commit graph, and tabs to start a
  task, ship it (commit per module in order, merge or pull request) and release it, with a preview before every run, conflict
  help and a history.
- Every command refuses to start while a rebase, merge or cherry-pick waits to be finished.
- `merge`: the whole way from a feature branch to the integration branch (fetch, rebase, push the branch, update the
  integration branch, merge, push it, come back), stopping at the first failure with the way to go on.
- `pick`: a release branch built from chosen commits, in the order given, with the conflict and the already-applied cases handled.
- Checks before anything changes: protected branches, a detached HEAD, uncommitted changes, commit message rules
  (`shuttle.messagePattern`, `shuttle.forbidTrailers`), commits only the local integration branch has.
- `--dry-run`, `--yes`, a prompt before every command that changes something, and a commit-msg hook.
