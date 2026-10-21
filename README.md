# git-shuttle

**The same steps, in the same order, with the same checks, every time you take a branch from your work to the integration
branch and to a release.** One command instead of a copied list of ten.

```
$ git shuttle merge
repository: my-project (/home/me/my-project)
branch:     feat/invoice-total
merge into: develop  (noff)
steps:      fetch, rebase on origin/develop, push feat/invoice-total, update develop, merge, push develop, back to feat/invoice-total
Ship 'feat/invoice-total' to 'develop'? [Y/n]
$ git fetch --quiet origin
$ git rebase origin/develop
$ git push -u origin feat/invoice-total
$ git checkout develop
$ git pull --ff-only origin develop
$ git merge --no-ff -m "Merge branch 'feat/invoice-total' into develop" feat/invoice-total
$ git push origin develop
$ git checkout feat/invoice-total
==> done: 'feat/invoice-total' is in 'develop' on origin
```

It is a thin layer over git, not a replacement: every command it runs is printed first, and it stops at the first thing that
fails, saying how to go on.

## Why

A team that merges feature branches into a staging branch and cherry-picks chosen commits into a release branch repeats the same
sequence all day. Done by hand it goes wrong in small ways: a commit made in the wrong repository, a push of the wrong branch, a
message that breaks the convention, a merge of a staging branch that has local commits nobody reviewed. `git-shuttle` makes those
mistakes hard.

- **It shows where you are** (repository and branch) before it acts.
- **It asks before every change**, and `--dry-run` shows the commands without running them.
- **It never forces.** A rejected push is reported, not retried with `--force`. `--force-with-lease` has to be asked for.
- **It never commits, rebases or pushes a protected branch** (the base, integration and release branches by default).
- **It checks the commit message** against rules you set, in `git shuttle commit` and, with the hook, in plain `git commit`.
- **It refuses to push commits you did not mean to**: a merge stops when the local integration branch has commits the remote lacks.
- **It leaves the repository for you to finish** when a conflict stops it, with the exact commands to continue or give up.

## Install

Needs `bash` 4.4 or newer and `git`. Linux, macOS (with a recent bash) and WSL2.

```bash
git clone https://example.com/git-shuttle.git     # use the address of this repository
cd git-shuttle
make install                                      # links bin/git-shuttle into ~/.local/bin
```

An executable called `git-shuttle` in your `PATH` is run by `git shuttle`. `make install PREFIX=/usr/local` installs for every user.

## Set it up once per repository

```bash
git shuttle init
```

It looks at the remote, proposes the base, integration and release branches (Enter keeps each proposal), and saves them in
`git config shuttle.*` of this repository. Without a terminal, give them as flags:

```bash
git shuttle -y init --integration develop --release release \
    --message-pattern '^\[[A-Z]+\] [a-z_]+: .+' --forbid-trailers "Co-Authored-By" --hook
git shuttle config      # shows what is in effect
```

Running `init` again keeps what is already set; an empty value (`--message-pattern ""`) removes a rule. The settings are plain
`git config` entries, so you can also change one by hand; add `--global` to apply it to every repository.

| Setting | Meaning | Default |
|---|---|---|
| `shuttle.remote` | the remote | `origin` |
| `shuttle.base` | the branch work starts from | the default branch of the remote |
| `shuttle.integration` | the branch features are merged into | `base` |
| `shuttle.release` | the branch a release starts from | `base` |
| `shuttle.protected` | branches no command here commits, rebases or pushes | base, integration, release, `main`, `master` |
| `shuttle.messagePattern` | an extended regular expression the first line of a message must match | none |
| `shuttle.forbidTrailers` | trailers a message may not have, space separated | none |
| `shuttle.mergeStrategy` | `noff` (a merge commit) or `ff-only` | `noff` |
| `shuttle.branchPrefix` | the start of the branch names `start` makes, e.g. `19.0-feature/` | `feature/` |
| `shuttle.releasePattern` | the name `release --onto auto` gives: `{date}` is YYYYMMDD, `{yymmdd}`, `{n}` the first free number | `release/{date}-v1.{n}` |
| `shuttle.upgradeCommand` | a test command the UI shows before a push, `{modules}` replaced by the changed modules (never run) | none |

## Commands

| Command | What it does |
|---|---|
| `git shuttle ui` | the web UI: your repositories and every command below, with a preview before each run (see [The web UI](#the-web-ui)) |
| `git shuttle init [--integration B] [--release B] ...` | sets the repository up in one go: proposes what it detects, saves it |
| `git shuttle start NAME [--from B]` | a branch for new work, cut from the remote integration branch: `"Keep order date"` becomes `feature/keep_order_date` |
| `git shuttle stage -- PATH...` | `git add` for the files you name (new files need it before a commit) |
| `git shuttle pr [--base B] [--title T] [--body-file F] [--draft]` | pushes the branch and opens a pull request with the GitHub CLI (`gh`) |
| `git shuttle continue` / `abort` | finish, or give up, the rebase, merge or cherry-pick that stopped on a conflict |
| `git shuttle candidates` | the branches merged into the integration branch that the release does not have yet |
| `git shuttle ship [-m MSG] [-- PATH...]` | commit (with `-m`), then everything `merge` does, after **one** question |
| `git shuttle release --onto NEW [--from BASE] [--push] BRANCH_OR_COMMIT...` | like `pick`, but a branch name stands for the commits it brought: no hashes to look up |
| `git shuttle status` | where you are and what is left to ship; changes nothing |
| `git shuttle commit -m MSG [-- PATH...]` | checks the branch and the message, then commits; with paths it commits only those files and leaves the rest staged |
| `git shuttle sync [--onto BRANCH]` | fetch, then rebase the branch on the remote integration branch |
| `git shuttle push [--force-with-lease]` | push the branch, setting the upstream the first time |
| `git shuttle merge [--into BRANCH] [--no-sync] [--force-with-lease]` | rebase, push the branch, update and merge into the integration branch, push it, come back |
| `git shuttle pick --onto NEW [--from BASE] [--strategy-option ours\|theirs] [--push] COMMIT...` | a release branch from the remote release branch, with the commits picked in order |
| `git shuttle hook install\|uninstall\|status` | a `commit-msg` hook that applies the message rules to every commit |
| `git shuttle config` | the settings in effect |

Options for every command: `-y/--yes` (do not ask), `-n/--dry-run` (show the commands only), `-h/--help`, `--version`.

### A day with it

```bash
git checkout -b feat/invoice-total develop
# ... edit ...
git add sales/
git shuttle ship -m "[FIX] sales: round the invoice total" -- sales    # commit + merge, one question

# later, a release made of the branches you name (their commits are found for you)
git shuttle release --onto release/2026-10-21 feat/invoice-total feat/other --push
git shuttle pick --onto release/2026-10-21 a1b2c3d e4f5a6b --push     # or the commits themselves
```

`release` reads a merged branch from its merge commit and a branch that is not merged yet from where it leaves the integration
branch. A branch merged by fast-forward or squash leaves no trace of its commits: give them as hashes.

### When it stops

| What happened | Exit status | What you see |
|---|---|---|
| refused before changing anything (protected branch, dirty tree, bad message, ...) | 1 | `error: ...` |
| stopped half way (a conflict, a rejected push) | 2 | `stopped: ...` with the commands to continue or give up |
| you answered `n` at the prompt | 3 | `Declined: nothing was changed.` |

## The web UI

```bash
git shuttle ui
```

Opens a page on your own machine that follows the same steps as the commands, for several repositories at once:

1. **Start** a task: a branch from the integration branch, named for you.
2. **Work and test**: the changed files, and the test command to copy (the UI never runs it) with a "tested" tick.
3. **Commit per module**: the changed files grouped by their first folder, in the order you choose (dependencies first), each with a
   message that is checked against your rules while you type.
4. **Merge**: directly, or through a pull request. A **preview** shows the exact git commands (`--dry-run`); the run button stays
   disabled until the preview is made for exactly what is on the screen.
5. **Release**: the branches merged since the last release, their commits to tick and reorder, the release branch name from your
   pattern, then a pull request to the release branch.

When something stops on a conflict, the page says which files, and has **continue** and **abort** buttons. Every action is
logged on your machine (`~/.config/git-shuttle/history.jsonl`).

It runs commands on your repositories, so it is built to be hard to misuse:

- it listens on `127.0.0.1` only, and refuses any `Host` or `Origin` that is not itself (DNS rebinding, other websites);
- every call needs the random token printed when it starts (the link carries it after `#`, which a server never sees in a log);
- nothing goes through a shell: every value is validated and becomes an argument of `git-shuttle`;
- only the repositories you registered can be acted on, and one action runs at a time per repository;
- the page loads no external script, style or font.

Python 3 (standard library only) is needed for it; the commands do not need it.

## What it does not do

It does not rewrite history for you, force a push, resolve conflicts or talk to a hosting service (opening a pull request is
left to the GitHub CLI, `gh`). It works
with the `git` you already have and its own configuration (`git config shuttle.*`); there is no other file to maintain.

## Development

```bash
make lint     # bash -n and ShellCheck
make test     # every test builds its own throw-away repositories; no network (the UI tests need python3 and node)
```

Tests use a bare repository as the "remote" and a clone as the working copy, with git isolated from the configuration of whoever
runs them. A change should come with a test, and `make lint && make test` must pass.

## License

MIT. See [LICENSE](LICENSE).
