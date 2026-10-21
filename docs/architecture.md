# Architecture

```
bin/git-shuttle          entry point: option parsing and command dispatch
lib/core/                what every command uses
    output.sh              messages, colours, exit codes, run (prints, then runs), confirm and ask
    config.sh              git config shuttle.*, the base, integration and release branches
    git.sh                 repository state: branch, clean tree, refs, operations in progress
    policy.sh              protected branches and the commit message rules
lib/commands/            one file per command (cmd_<name>), loaded by bin/git-shuttle
ui/shuttle_ui/           the web UI: a Python package, standard library only
    cli.py                 command line and server start         api.py       the routes
    http.py                requests, security checks, static files   validate.py  what the page may ask for
    runner.py              runs git-shuttle, reads --porcelain      jobs.py      one action at a time per repository
    store.py               registered repositories and history      graph.py     the commit graph from `git log`
    static/                the page: ES modules and one CSS file, no build step
        js/                  main.js, runner.js, api.js, logic.js (pure), graph.js (pure), components/
        vendor/              Preact and htm in one file, committed as is
tests/
    cli/                   one bash suite per area, each in throw-away repositories
    helpers/               assertions and the sandbox (a bare "remote" and a clone)
    ui/                    server tests (python3) and pure-logic tests (node)
```

## Rules the code keeps

- **A command has one job and one exit status**: 0 done, 1 refused before changing anything, 2 stopped half way, 3 declined.
- **`run` is the only place a changing command is executed.** It prints the command first, and honours `--dry-run`.
- **Checks come before changes.** A command that is going to be refused is refused before the first git command that writes.
- **`die` inside `$(...)` only leaves the subshell.** Functions that must stop the command set a global (`need_branch`,
  `load_branches`) instead of printing a value.
- **Machine-readable output is `--porcelain`**: NUL separated `key=value` records. The UI reads that and nothing else.

## The UI is a client of the CLI

The server adds no git logic. An action in the page becomes a list of `git-shuttle` argument lists (`validate.build_commands`),
shown with `--dry-run` for the preview and run without it for the job. What the page draws comes from `status --porcelain`,
`candidates --porcelain` and one read-only `git log` with fixed arguments (`graph.py`).

The graph is laid out in the browser (`static/js/graph.js`, a pure function with its own tests): each commit takes the column
of the lane that waits for it, and its parents take columns for the next row.

## Adding a command

1. `lib/commands/<name>.sh` with a `cmd_<name>` function; add it to `main()` and `usage()` in `bin/git-shuttle`.
2. A suite in `tests/cli/`, run through `tests/run.sh`.
3. If the page needs it: a case in `validate.build_commands`, and a test in `tests/ui/test_server.py`.
