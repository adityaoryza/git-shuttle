# Contributing

Bug reports and pull requests are welcome.

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Set up

Needs `bash` 4.4+, `git`, `shellcheck` (lint), `python3` and `node` (the UI tests). Nothing else is installed.

```bash
make lint      # syntax checks and ShellCheck
make test      # all suites; `bash tests/run.sh cli|server|front` runs one
```

## What a good change looks like

- It does one thing, and touches only the files that thing needs.
- It comes with a test. A command's behaviour is tested in `tests/cli/` in a throw-away repository (the helpers give you a bare
  "remote" and a clone); a UI rule in `tests/ui/`. A bug fix starts with the test that fails.
- Edge cases are tested, not only the happy path: a conflict, a rejected push, a dirty tree, a detached HEAD, odd file names.
- A command that changes something prints it first, goes through `run`, and honours `--dry-run`. One that rewrites history refuses
  commits that are on a remote (`refuse_pushed`), and one that moves branches is `journaled`, so `undo` works.
- Everything the tool can do is reachable from the page: add the command to `ui/shuttle_ui/actions.py` (a test fails otherwise).
- Messages are short and say what to do next. English, no jargon.
- `make lint && make test` pass.

Read [docs/architecture.md](docs/architecture.md) first: it lists the rules the code keeps.

## Commits

One subject line in the imperative, e.g. `Refuse a merge when the integration branch has local commits`.
