# The web UI

`git shuttle ui` starts a small server on `127.0.0.1` and opens the page. It prints a link with a random token; keep it private.

```bash
git shuttle ui [--port N] [--no-open] [--repo PATH]...
```

## What you see

- **Top bar: the current branch.** Click it for the branch picker: filter, switch (a remote-only branch gets a local copy), and an
  eye on each branch, on each folder (the part of the name before the first `/`, such as `19.0-feature/`) and on the Local and Remote
  groups, to hide them from the graph. Groups and folders collapse; searching opens them. The choice is kept per repository in the
  browser. Where you are is always drawn, even when hidden.
- **Right-click a commit** (menu key or Shift+F10 on a focused row also work): *Cherry-pick onto <branch>*, *Create a branch
  here…*, *Switch to / Check out* for the branches that point at it, *Copy SHA*, *Copy message*. Cherry-pick and branch creation open
  the dry run first; an entry that cannot work is greyed out with the reason.
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

**Theme and icon.** The top bar has a button that cycles system → light → dark. The choice is kept in `localStorage` and put on
`<html data-theme>` by a tiny external script (`js/theme-init.js`) before the styles are used, because the content security policy
allows no inline script. Without a choice the page follows `prefers-color-scheme`. The icon is `favicon.svg` (a blue rounded square, so it
reads on light and dark tab bars), `favicon-32.png`, `apple-touch-icon.png` and `favicon.ico` (also answered at `/favicon.ico`).

State kept on your machine, in `~/.config/git-shuttle/` (mode 700): the registered repositories (`repos.json`) and what was run
(`history.jsonl`).

## Security model

The server can run git-shuttle in your repositories, so a website you visit must not be able to drive it.

| Threat | Defence |
|---|---|
| another machine on the network | listens on `127.0.0.1` only |
| a website calling `localhost` | every API call needs the token in a header; the page reads it from the URL fragment (never sent to a server, never in a log), removes it from the address bar and keeps it for that tab only (`sessionStorage`), so a refresh works and closing the tab forgets it; `Origin` must be this server |
| DNS rebinding | the `Host` header must be this server's own address |
| a request forged without a preflight | a POST must be `application/json` |
| shell injection | nothing goes through a shell; every value is validated and passed as an argument; branch names and paths cannot start with `-` or leave the repository |
| acting on any directory | only repositories registered by the user |
| script injection into the page | `Content-Security-Policy: script-src 'self'; style-src 'self'`, all text inserted as text, no external resource |
| reading other files | only files under `static/` with a known extension (html, js, css, svg, png, ico) are served; the resolved path must stay inside it |
| a diff that runs a program | the commit and diff views pass `--no-ext-diff --no-textconv`: a `diff.external` or `textconv` in the git configuration is not run; the arguments are fixed, the commit id is hex and the path relative |
| a huge diff | cut at 5000 lines or 300 KB (and said so); untracked files over about 1.2 MB are not read; symbolic links are not followed |
| oversized requests | 1 MiB limit |
| two actions at once | one job per repository |

## Front end

Plain ES modules and one CSS file; no build step and no Node needed to run it. The components are [Preact](https://preactjs.com)
with [htm](https://github.com/developit/htm) (`static/vendor/`, one 13 KB file). The look follows the shadcn/ui design tokens
(neutral zinc palette, 6 px radius, light and dark by the system setting) written as plain CSS.
