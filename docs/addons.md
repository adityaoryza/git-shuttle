# Add-ons

An add-on tells git-shuttle things it cannot know by itself: the task a branch is for, the text of a pull request, a card for the web UI.
It is a **program named `git-shuttle-NAME`** that is on your `PATH`. git-shuttle runs it with JSON on standard input and reads JSON from its
standard output; nothing of it is loaded into git-shuttle, and nothing it says is trusted until it has been checked.

Examples of what an add-on can do: an integration with a tracker (Odoo, Jira, Linear, GitHub Issues) that starts a branch from a task, fills
the pull request from it, and shows the task in the web UI. The add-on of [odoo-task-fetch](https://github.com/adityaoryza/odoo-task-fetch)
is the first.

## Using one

```bash
git shuttle addon list                # the add-ons found on the PATH, and whether each is enabled
git shuttle addon info NAME           # what it asks for (this runs it once, with --shuttle-manifest)
git shuttle addon enable NAME         # shows what it asks for, asks, and saves it for this repository (--global: for every repository)
git shuttle addon disable NAME        # removes its settings (the program itself is not touched)
git shuttle addon check NAME          # for its author: does it answer the way the protocol says?
git shuttle addon cards [--porcelain] # what the add-ons show for the branch you are on
```

An add-on does nothing until you enable it. Enabling **pins the program** (the SHA-256 of the file): if it changes, for example after an update,
git-shuttle refuses to use it until you enable it again, which shows what it asks for once more.

What an enabled add-on adds:
- **Flags** on a command, like `git shuttle start --task 15607`: they exist only when the add-on declared them.
- **Hooks**: `start` (it proposes the name of the branch and says what the branch is for), `pr` (it proposes the title and the description
  of the pull request), `status` (it gives the cards of the web UI). What you type always wins over what an add-on proposes.
- **Its own command**: `git shuttle NAME ARGS` runs `git-shuttle-NAME ARGS` (with your terminal, as any command you type).

### `setup` hook: the credentials of an add-on

An add-on that needs a login or a key says so with the `setup` hook, and the web UI shows a form (**Add-ons**, then **Set up**; or
`git shuttle addon setup NAME`). `{"action":"status"}` answers `{"ready", "note", "fields":[{"key","kind","label","help","required","set","value"}]}`
(kind: `text`, `secret`, `path` or `url`; at most 10 fields; a `secret` never has a value, only `set`). `{"action":"save","values":{...}}` answers
`{"ok","message"}`: the add-on tests the values and keeps them in its own store. git-shuttle keeps nothing: the values reach the add-on on
standard input (`git shuttle addon setup NAME --save` reads them from standard input, never from the command line, where others could see
them), are not written to any log, and a value that the add-on repeats in its message is hidden. The add-on must be enabled first.

### `status` hook and the refresh

`git shuttle addon cards --refresh` (the Refresh button of a card) calls the `status` hook with `args.refresh = "1"`: the add-on reads its source again
before it answers (odoo-task: fetches the task from Odoo, which is a read; the hook has the longer time of `tasks`). An add-on that does not know the
argument just answers as always. A card's `text` may have up to 5000 characters; the page shows the first lines and "Show all".

### `report` hook: the pull request and the commits, for the people who follow the task

After `git shuttle pr`, and after `git shuttle merge` or `ship` (a merge without a pull request), an add-on may add the steps of the branch (and its pull request, when it has one) to the task it is for (odoo-task: the Customer report,
the custom field `x_customer_report`), so that the PM can check them on GitHub. It is the only way an add-on can write, and it has rules:
- **Off until you turn it on, for one repository**: `git shuttle addon report NAME on` (the button *Customer report* in the Add-ons dialog).
- **Shown first, asked, then written**: the hook is called with `{"action":"preview"}` (the add-on says what it would add) and, after your
  answer (or `--yes`, which the web UI gives after its own preview), with `{"action":"post"}`. `git shuttle trace report` does the same for a branch that already has a pull
  request or steps in the trace (a merge made by hand is not in the trace: link the branch with `git shuttle trace bind`).
- **Only adds, except its own block**: the add-on keeps the text that is there. The steps of the task are one block (`<div id="git-shuttle-flow">`) at the
  start of an html field, and a later run replaces that block and nothing else; it reads the
  field again and puts the old value back if the text that is not the block is not all there. odoo-task writes only a custom field (`x_...`) of text or html type
  of one task, and nothing else.
- **A failure never undoes the pull request**: it is a warning, with the way to try again.

The input may also have `phases`: the steps of the task from its trace, `[{title, when, items: [{text, url, ref, at}]}]` (`ref` is a text that stays visible in the
report, and an item whose ref is there already is not written again; `at` is a time that the add-on shows in the time of the user). The input has `branch`, `ref_id`, `pr` (`url`, `title`, `base`), `commits` (`sha`, `subject`, `url`) and `repo.web` (the address of the repository
without anything that comes before the `@` of a remote); the answer is `{"ok", "message", "text", "field", "skipped"}`.

### `tasks` hook, `details`, and the trace

`tasks` lists the tasks of the user (up to 60: `id`, `title`, optional `subtitle`, `link`, up to 8 `fields`, and a `note`); the Start tab of the web UI
offers them to pick from (45 s allowed, `GIT_SHUTTLE_ADDON_TASKS_TIMEOUT`). `reference.details` (up to 12 `label`/`value`) of the `start` hook is
kept with the start of the task.

Every step on a branch that is for a task is written to `<git dir>/shuttle-trace/events.jsonl` (private, never pushed): start, commit, push, pr, merge,
release, and the deploys that carried the merge. A release made by naming commits (the Release tab sends hashes) is recorded on the task those
commits belong to. A deploy of the release line shows on that task when the release branch is part of what was deployed; a cherry-pick that was
made before this was recorded is recognized by its patch when the trace is read. `git shuttle trace list` and `trace show ID --addon NAME` read it
(in your time zone); the web UI shows it in **Tasks**.

A branch that already had work is linked afterwards: `git shuttle trace bind 15530 [--addon NAME] [--branch NAME] [--force]`, or **Tasks**, then **Link a
branch** in the web UI (after a preview). The add-on is asked for the task (its `start` hook), the branch remembers it, and what the branch already
did is written with its real dates: its start, its commits that the integration branch does not have, and, when `gh` finds them, its pull request
and the merge (a merged branch has its commits from the pull request). Run again, it adds only what is missing. A shared branch (the integration
or the release branch) cannot be linked, and a branch that is for another task needs `--force`.

A branch remembers what it is for: `branch.NAME.shuttle-ref-addon`, `-id`, `-title` and `-link` in the settings of the repository.

## What git-shuttle guarantees

- It downloads an add-on **only when you ask** (`git shuttle addon install NAME`, or Install in the Add-ons dialog), only one that is in
  `lib/addons/registry.json`, from the releases of the repository named there, over https, and checks the file against the `SHA256SUMS` of the
  release before it unpacks it (links and `..` in the archive are refused). Installing runs nothing; the add-on stays disabled until you enable it.
  What you trust is the owner of that repository. It never runs an add-on that is not enabled (except `info`, `enable` and `check`).
- An add-on runs **alone**: no terminal, standard input is the JSON and nothing else, a time limit (20 s, `GIT_SHUTTLE_ADDON_TIMEOUT`) and a size
  limit (256 KiB) on what it says, in its own session.
- It receives only a short **environment** (`PATH`, `HOME`, `LANG`, `TERM`, `XDG_CONFIG_HOME`, `TMPDIR`) and the variables its manifest declared (up to 10,
  shown when you enable it). Nothing else of your environment: no token reaches it.
- Every answer is **checked** (`lib/addons/protocol.py`): unknown fields are dropped, texts are cut to a size, control characters are removed, a
  branch name keeps only letters, digits and simple punctuation (the rest, like quotes, is dropped), an address must be `http` or `https`, an identifier has a short safe alphabet. A refused answer
  stops the command with the reason (or, for the text of a pull request, is skipped with a warning). Nothing it says is ever run.
- The add-on must be able to be a different program from yours: add-ons that are not enabled are only listed.
- Names of git-shuttle's own commands cannot be taken, and neither can the flags of git-shuttle.

An add-on has the rights of the user that runs it, like any program on the PATH. Enable only what you installed on purpose.

## Writing one

The program is called `git-shuttle-NAME` (lowercase letters, digits and `-`, 31 characters at most, not a command of git-shuttle). It is
called in two ways, and answers on standard output with one JSON object. A message on standard error and a non-zero exit mean "failed": exit status 1 with a message is an honest "I cannot" (an unknown task, no connection), and git-shuttle shows the message; a crash or any other status is a defect, and `addon check` reports it.

### `git-shuttle-NAME --shuttle-manifest`

```json
{
  "protocol": 1,
  "name": "task",
  "version": "0.1.0",
  "description": "Tasks of a tracker",
  "hooks": ["start", "pr", "status"],
  "flags": {"start": ["--task"]},
  "env": ["ODOO_API_KEY"]
}
```

`protocol` must be `1`. `name` must be the name of the program. `hooks` lists what it takes part in. `flags` adds flags to `start` (a flag
that git-shuttle uses itself, like `--from`, is refused; the add-on of a flag must have the hook of its command). `env` lists the environment
variables it needs, and only those are passed.

### `git-shuttle-NAME hook HOOK`

The context is on standard input. Every hook gets `protocol`, `hook`, `repo` (`root`, `name`) and `args` (the values of the flags it declared,
without the dashes: `{"task": "15607"}`); the others are added to the top level.

| hook | also in the input | the answer (every field is optional) |
|---|---|---|
| `start` | `repo.branch_prefix` | `{"branch": "text for the name", "reference": {"id": "15607", "title": "...", "link": "an http or https address"}, "note": "shown to the user"}` |
| `pr` | `branch`, `base`, `commits` (oldest first, one per line: a short hash, a space, the subject), `ref-id`, `ref-title`, `ref-link` | `{"title": "one line", "body": "markdown"}` |
| `status` | `branch`, `ref-addon`, `ref-id`, `ref-title`, `ref-link` | `{"cards": [{"title": "...", "subtitle": "...", "link": "an http or https address", "text": "...", "fields": [{"label": "Stage", "value": "Running"}]}]}` |

Limits: `branch` 120 characters, `title` 200, `body` 20,000, a card has at most 12 fields, a hook answers at most 5 cards, `note` 500.
The `branch` is only a text: git-shuttle makes it a branch name (`Keep manual Order Date` becomes `feature/keep_manual_order_date`), so an add-on
that wants no tag or number in it removes them itself.

Run `git shuttle addon check NAME` while you write it: it asks for the manifest and calls every hook with a made-up context, and says which
answer the protocol refuses. A minimal add-on:

```bash
#!/usr/bin/env bash
case "${1:-}" in
    --shuttle-manifest) echo '{"protocol":1,"name":"hello","hooks":["status"]}' ;;
    hook) cat >/dev/null; echo '{"cards":[{"title":"Hello from an add-on"}]}' ;;
esac
```
