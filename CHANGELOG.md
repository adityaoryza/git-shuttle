# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-21

### Added
- `git shuttle status`, `commit`, `sync`, `push`, `merge`, `pick`, `hook` and `config`.
- `init`: sets a repository up in one go, proposing what it detects. `ship`: commit and merge after one question
  (or open a pull request with `--pr`). `release`: `pick` where a branch name stands for the commits it brought, with
  `--onto auto` for a name from `shuttle.releasePattern`.
- `start`, `stage`, `pr`, `continue`, `abort`, `candidates`, and `status --porcelain` (for programs).
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
