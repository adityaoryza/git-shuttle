# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and the project follows Semantic Versioning.

## [Unreleased]

## [0.12.0] - 2026-10-27

### Changed

- The task picker (Start tab, Tasks dialog): every filter has a caption (Stage, Project, Fetched, Order); each task is two lines (number, title and pills, then its project and fetch state); the stage is coloured by what it says (done, waiting, running); the list scrolls by itself and no longer passes the scroll on to the panel.
- When the add-on does not answer (Odoo is slow or off), the picker shows a warning with a *Try again* button instead of a grey line.
- The task filter of the toolbar is marked when it is on (a teal frame) and has a button to clear it.

### Fixed

- The browser tests no longer see an add-on that is installed on the machine (`git-shuttle-odoo-task`) next to the stand-in they use.

## [0.11.3] - 2026-10-26

### Fixed

- The trace of a task shows the deploy of its release branch: a release branch holds cherry-picks (other hashes), so the merge of the task was never in what was deployed to production. A deploy of the release branch of the task, after its release, is now part of its trace.

### Changed

- The Customer Report names a deploy of a branch with `release` in its name `Deployed to prod`; the other deploys stay `Deployed`.

## [0.11.2] - 2026-10-26

### Changed

- The texts of the Customer report (Add-ons, Tasks, `git shuttle addon report`, docs/addons.md) say that the add-on changes only its own block of steps and keeps the rest, because odoo-task 0.6.0 keeps the steps in one block at the start of the field.

## [0.11.1] - 2026-10-26

### Fixed

- The step **Pushed** of the Customer Report was written again on every `git shuttle trace report`, because the add-on could not find it in the field. It is written once for each push now.

## [0.11.0] - 2026-10-26

### Added
- The **Customer Report** shows the steps of the task, from the trace (git shuttle trace report): Started, Linked to the task, Commits (those of the pull request, or the
  ones of the branch that are still in it, not the ones that were rewritten), Pushed, Pull request, Merged, Released, Deployed, each with its date and its links. Each step is
  written once: a later `git shuttle trace report` adds only the steps that are new (a task without a trace keeps the report of the pull request and its commits).

### Fixed
- A branch made with `git shuttle branch` (the Branch button) from a branch of a task is for the same task: it takes the link, the trace says "Branch made", and
  its commits get the badge of the task at once. A branch that is made with plain git is not seen: link it in Tasks, Branches.
- The web addresses in the text of a card (http and https only) are links that open in a new tab, without opener or referrer.
- The commits that the Customer Report lists are the commits of the task: those of its pull request when there is one (a branch can also hold merges of staging and the
  work of another task, which are not the task's), else the commits of the branch without its merges.

## [0.10.0] - 2026-10-26

### Added
- The card of a task (Start and Ship tabs) has a **Refresh** button: the add-on is asked to read its source again (`git shuttle addon cards --refresh`;
  odoo-task fetches the task from Odoo, a read, with its latest messages) and the card shows what it says now, and whether it changed. A long text is
  shown in its first lines with "Show all", and its line breaks are kept.
- The conflict dialog has a clear palette: one colour for each version (blue for what is already there, orange for your change, apart for people who do
  not see red and green), kept lines tinted and ticked, left-out lines grey (struck through once the change is decided), the result carries the colour of
  each line's origin with a legend, the chosen answer is filled and ticked; the contrast is checked in the dark and the light theme.
- **Code has the colours of an editor**: keywords purple, names of functions yellow, classes teal, `self` and constants blue, strings orange, numbers green,
  comments green and italic, decorators, XML attributes; in the conflict dialog and in every diff, in both themes.
- **Start from a task**: once a task is chosen, the name of the branch can be fixed by hand (a field under the task; empty keeps the name from the task).

## [0.9.2] - 2026-10-26

### Fixed
- A **release branch** (a branch made with the release pattern of Settings, like `19.0-release/261023-v1.2`) is cut from the release branch, but it was
  compared with the integration branch (staging): the top bar said "1226 behind origin/19.0-staging" and the main button said "Update from
  origin/19.0-staging", which would have brought the whole of staging into the release. Now a release branch is compared with the release branch
  and `git shuttle sync` rebases it on that one; a task branch is compared with the integration branch as before.
- `git shuttle ship` and `git shuttle merge` on a release branch are refused (they would have rebased the release on staging, pushed it, and merged it
  there): a release branch goes to the release branch with a pull request (`git shuttle ship --pr`). A pull request opened from a release branch goes
  to the release branch by default, and `ship --pr` brings the branch up to date from the release branch, not from staging.
- Commands that start while the look for a newer release is on its way no longer start a look each (six quick commands made thirteen requests).
- The test run gives each file five minutes: a file that hangs no longer holds the whole run.
- The dialog that resolves a conflict is in plain words: each change asks "Which version should the file keep?" with three answers (the version that is
  already there, your change, or both), the two versions have plain titles instead of git's *ours* and *theirs*, the lines show real check boxes, the result
  is shown in a box of its own, and the original and who changed the lines are folded under "More". The messages of the page no longer cover its buttons.
- A branch that is merged already (the base it is compared with contains it) is no longer offered "Update from…": there is nothing to update.

## [0.9.1] - 2026-10-23

### Added
- **Resolve a file line by line**: *Choose place by place* is now a big dialog with the code line by line, the two sides next to each other, and under
  each place the exact text that will be written. A click on a line keeps it or leaves it out; a button takes a whole side, or both in either order,
  for one place, and the buttons at the top do it for all the places. For the command: `git shuttle resolve --hunk N=pick:o1+t2+o3 -- FILE` takes the
  lines of ours (`o`), theirs (`t`) or what both started from (`b`), numbered from 1, in the order given; `pick:` alone takes the place out of the
  file. A line that does not exist is refused before anything is written, also in a dry run. `conflicts --porcelain` reports the number of lines of
  each side.

### Fixed
- **An update, and `install.sh` run again, no longer remove the add-ons that were installed.** They live in the program folder (`addons/`), which was
  replaced as a whole, so every update meant installing and enabling them again. They are carried into the new copy as they were, so an enabled
  add-on stays enabled (its pin is the checksum of its program); if that cannot be done, the update is not made. (This holds for the update *from* this
  version on: the version that is being replaced does the swap.)
- The files of a conflict in the banner are laid out one block each (name and what it means on top, the choices under it); the Keep buttons with a long
  branch or commit name are no longer clipped, and they stack at the width of a phone.

## [0.9.0] - 2026-10-23

### Added
- **Keep one side of a conflict**: `git shuttle resolve --ours|--theirs -- PATH...`, and two buttons next to every file in the banner of a
  stopped rebase, merge, cherry-pick, revert or patch. It says which branch each side is, and in a rebase it names them the right way round
  (git's "ours" is what you rebase onto, "theirs" is your own work). The preview says which branch is kept and which is dropped. A side that
  deleted the file keeps it deleted. `git checkout --merge -- FILE` brings the conflict back. `status --porcelain` reports `conflict.ours`,
  `conflict.theirs` and their roles.
- **A release that conflicts is finished from where it stopped**: `pick`, `cherry-pick` and `release` keep a plan in the git folder (the commits, in
  order, and where it stands). The page says *Commit 3 of 7*, with the commits done and the ones to come. `git shuttle continue` finishes the commit
  that stopped (one that has nothing left after the resolution is skipped), goes on with the rest by itself and, with `--push`, pushes at the end;
  before, the rest was forgotten and the push never happened. `abort` forgets the plan. When it is over, `status --porcelain` reports
  `release.ready`, and the release tab offers the pull request to the release branch. `cherry-pick` takes `--push` too.
- **Resolve place by place**: `git shuttle conflicts FILE` lists the places where a file is in conflict (both sides, what both started from, and who
  last changed the lines of your side, with the commit of the release it was) and `git shuttle resolve --hunk N=ours|theirs|both|both-reverse|base
  -- FILE` chooses. The page shows it as *Choose place by place*, with a choice for each place and a preview before anything is written.
- **New branch** offers templates of the name: the prefix of task branches, the prefixes in use and the next release name.
- **The look for a newer release is made at every start of the page** (a line on the terminal when one is out), and then every ten minutes (it was once
  an hour, and never at the start). A command of git-shuttle looks at most every ten minutes too. What the page itself runs does not look at every
  command: the server does, once.
- **An update made from the page restarts the server by itself**: the same process, port and link start again with the new code, and the page reloads
  when it is back. No more Ctrl-C and `git shuttle ui` again (where the server cannot restart by itself, Windows, the page says so).

### Changed
- `git shuttle continue` after a `pick`, `cherry-pick` or `release` that stopped goes on with the commits that are left; it used to finish only the one that
  stopped. The message of a pick that stops says `git shuttle continue` (not `git cherry-pick --continue`) and `abort` gives up the whole pick.

### Fixed
- The buttons of the Add-ons dialog (Customer report, Set up, Disable, Update, Remove) looked like plain text; they are buttons now.

## [0.8.1] - 2026-10-23

### Changed
- The look of the web page: one accent colour, petrol (`--brand`), over slightly cooler neutrals, in the dark and in the light theme. It marks
  what you can act on (the main button, links, the selection, focus, the current branch). `--info` stays blue and only means information, next to
  `--ok`, `--warn` and `--bad`. Every text keeps a contrast of at least 4.5:1.

### Fixed
- *Add a repository* no longer stays empty ("that folder does not exist", "Loading...") when the folder the browser remembers is not one this
  server has: the browser keeps it for the address (`127.0.0.1:7788`), whichever server answers there (WSL, Windows, another machine). It is
  forgotten and the list starts at the home folder.

## [0.8.0] - 2026-10-23

### Added
- The **Customer report** (add-on hook `report`, opt-in for each repository): after `git shuttle pr`, the add-on of the task can add the pull request and
  the commits to the task (odoo-task: the field `x_customer_report`), for the PM to check on GitHub. It shows the text first and asks, it only adds
  (what is there is kept, an entry for the same pull request is not added twice, the old value is put back if Odoo changed it), and a failure never
  undoes the pull request. `git shuttle addon report NAME on|off`, `git shuttle trace report` (for a pull request that is already open), the button
  *Customer report* in the Add-ons dialog and *Report* in Tasks, Branches.
- A command of git-shuttle looks for a newer release by itself, in the background (at most once an hour, never waited for, off with
  `GIT_SHUTTLE_NO_UPDATE_CHECK=1` or the switch of the About dialog), so the page shows the reminder as soon as it is opened, and says
  "git-shuttle X is out" once per release on a terminal. The page asks the server again every ten minutes and when the tab comes back. The look is
  still only the number of the latest release; before, only the web UI server made it, at most once a day.

## [0.7.0] - 2026-10-23

### Added
- `git shuttle trace bind TASK`, and **Link a branch** in the Tasks dialog of the web UI: a branch that already has commits is linked to a task, and
  its past (start, commits, pull request, merge) is added to the trace with the dates it really had. A branch that was merged (it points at its
  merge, or is in the history of the base) gets the commits that the merge brought. Times are shown in your time zone.
- The Tasks dialog has two tabs: **Tasks** (click a task to open its timeline in place, with the branches and the last step; a long list of commits
  is folded) and **Branches** (the linked branches with **Unlink**, and the form to link one: the branch is searched by typing, and the task that
  is picked is marked, with a summary of what will be linked). `git shuttle trace unbind` takes a branch out of its task (its steps leave the trace).
- The graph marks the work of a task: a badge with the number of the task on its branch and on its commits (also the commits that were not made
  by git-shuttle, as long as they are on a branch that is for the task and not yet in the integration branch), and the search finds a task number.
  The pointer on a badge shows the title of the task, and a click opens the task itself in a new tab (when the add-on gave its address).
  `git shuttle trace map` gives the same to scripts.
- A **task** list in the toolbar narrows the graph to the commits and branches of one task, with a way back ("Show all tasks").
- The Release tab can pick by task: the commits show the badge of their task, a **Task** list limits them to one task (or to the ones of no task), the
  search finds a task number or title, and "Select all of this task" cherry-picks only the commits of that task.
- The task picker of the Start tab has filters (stage, project, fetched or not), a sort, a search, "Include done and closed" and a mark on the newest.

### Fixed
- A task whose title has quotes, a question mark or a dollar sign (`Copy "Export" to Accounting`) made `start --task` fail with "branch has
  characters that are not allowed". What is not simple text is now dropped from the proposed name (a path, `..`, is still refused).
- A shared branch (the base, the integration or the release branch, or a protected one) cannot be linked to a task: it marked all its commits.

## [0.6.0] - 2026-10-23

### Added
- Add-ons: programs named `git-shuttle-NAME` that tell git-shuttle more, with a documented protocol (`docs/addons.md`, protocol 1). `git shuttle
  addon list | info | enable | disable | check | cards`. An add-on does nothing until it is enabled, and enabling pins the program (its
  checksum): if it changes, it must be enabled again. It runs alone (no terminal, only the JSON as input, 20 s, 256 KiB, a short environment plus
  the variables it declared) and everything it says is checked before it is used. Hooks: `start` (a name for the branch, and what the branch
  is for: a task, kept in the settings of the branch), `pr` (the title and the description), `status` (cards for the web UI); an add-on
  can add flags (`git shuttle start --task 15607`) and its own command (`git shuttle NAME ...`). What is typed always wins over what an add-on
  proposes. `git shuttle addon check NAME` tells an author whether the add-on follows the protocol.
  In the web UI: the dialog **Add-ons** (Ctrl+K) lists them with Enable and Disable (after a preview that shows what the add-on asks for),
  the Start tab gets a field **Start from a task** for each flag that an enabled add-on adds to `start`, and the Start and Ship tabs show the
  cards of the add-ons (an answer that is refused shows nothing but its reason).
- Add-ons can be installed from a list that ships with git-shuttle (`git shuttle addon available | install | uninstall`): the release of its
  repository over https, checked against its checksums, never run until you enable it. A `tasks` hook lists the tasks to pick from in the Start tab.
- Add-ons can ask for their credentials: a `setup` hook, the dialog **Set up** in the Add-ons dialog (a key is typed in a hidden field, goes to
  the add-on on standard input and is never kept, logged or shown back) and `git shuttle addon setup NAME [--save]`.
- A trace of every task (`git shuttle trace list | show`, and **Tasks** in the web UI): start (with the details the add-on knew), commit, push, pull
  request, merge, release and the deploys that carried it. It stays in the `.git` folder of the repository and is never pushed.
  In the web UI, an icon in the top bar opens the Add-ons dialog (installed and available).

## [0.5.0] - 2026-10-23

### Changed
- A job shows what the command prints while it runs (the lines of the server during a deploy), and the view follows the last line, unless
  you scrolled up. Before, the output came only when the job had ended, and the page had only a "running" badge to show.

### Fixed
- A browser test of the Deploy tab dismissed the toasts of a job too early (the failure comes a moment after the success) and then waited for a
  toast that never leaves: it now dismisses until nothing shows up.

## [0.4.2] - 2026-10-22

### Fixed
- A setting changed just before a reload (a column width, the theme, a filter of the log) was given back as the older value: the copy that
  goes to the server a moment after a change had not arrived yet, and what the server kept won over the storage of the browser. Changes that
  have not been sent are now sent when the page is left (a request that still reaches the server when the tab is closed or reloaded).

## [0.4.1] - 2026-10-22

### Fixed
- The branches hidden from the graph (the eyes), how the branch list was left, the theme, the widths of the columns and the other settings
  of the page were forgotten whenever `git shuttle ui` ran on another port: the browser keeps its storage per address and port, and the
  server takes a free port when 7788 is busy. They are now kept by the server (`~/.config/git-shuttle/prefs.json`, private) and come back
  whatever the port. What a browser kept before is sent to the server once.

### Changed
- API level 8 (the settings routes): an older server shows the "stop it and run git shuttle ui again" banner.

## [0.4.0] - 2026-10-22

A reminder in the web UI when a newer release is out, with the update one click away; and fixes for the Deploy tab and the branch list.

### Added
- A reminder in the web UI that a newer git-shuttle is out, like the one of other apps: a slim bar under the top bar with what changed,
  **Update to X** (it updates right there, shows "Updating…", then says to restart `git shuttle ui`) and **Later** (for that release only; a
  newer one reminds again). A copy that cannot be updated from here (a git clone) gets **How to update**, which opens About. The server looks
  at most once a day (an hour after a look that failed) for the number of the latest release: one request to github.com, the one the Update
  button makes, with nothing about you or your repositories; the page never talks to the internet, and the answer is kept in
  `update-notice.json`. About has "Remind me when a new version is out" to turn it off, and `GIT_SHUTTLE_NO_UPDATE_CHECK=1` turns it off for
  good. The command line still asks nothing by itself.

### Fixed
- A fetch that lost a race with another git (an editor, a second window) failed with "cannot lock ref ... is at A but expected B", and the
  Deploy tab said "Cannot deploy yet". The fetch is now tried once more after a second (every command that fetches), a real failure is
  still shown with its reason, and the plan error of the Deploy tab has a "Try again" button.
- The branch list no longer closes when you open the actions menu (the three dots) of a branch: the menu opens over the list. Escape closes
  the menu first and the list second; choosing an action, or clicking away, closes both; a refused action leaves them open.

### Changed
- API level 7 (the notice routes): an older server shows the "stop it and run git shuttle ui again" banner.

## [0.3.3] - 2026-10-22

### Fixed
- Using a saved password no longer leaves the page waiting for the keychain: it is read by the job, not by the request. PowerShell of
  Windows can take more than 30 s to start (a cold start took 13 s here), so the wait is now 120 s with one more try, and when the keychain
  does not answer the job stops with the reason and the page shows the field to type the password (which can be saved again).
- A browser test of the table (resizing a column with the pointer) started the drag where the handle had been before the table was laid
  out again, and failed now and then on a slow runner: it waits until the handle stops moving.

## [0.3.2] - 2026-10-22

### Fixed
- A page that is closed or reloaded while it waits for an answer no longer makes a traceback in the window of `git shuttle ui`
  (BrokenPipeError, then a second one while the error page was sent): the connection is dropped quietly.

- Two tests that depended on timing now wait for what they need: the one that checks the opening of the browser (fake programs that write
  in the background), and the Deploy scenarios of the browser tests (an error toast stays until it is dismissed, and the pointer must not be
  left where the next toast appears). They failed now and then on a slow runner.

### Changed
- The repository is set up as an open source project: code of conduct, a feature request template, CODEOWNERS, Dependabot for the actions
  of the CI, badges in the README, and the supported versions in SECURITY.md.

## [0.3.1] - 2026-10-22

### Added
- "Remember on this computer" in the Deploy tab (opt-in, per server): the password is kept by the system and nothing else. On Linux by the
  keyring of the desktop (`secret-tool`); on Windows and WSL by Windows itself (DPAPI, through PowerShell: only the protected text is kept in
  the config folder, useless on another computer or for another Windows user); not on macOS yet, and never in a file in clear. It is kept
  only after a login that worked, bound to the repository, the server and its address, never sent back to the page (which only shows
  "Password saved" and Forget), and used only to answer the prompt of ssh or sudo. A key is still the safest way: `ssh-copy-id` once.
- The Deploy tab asks for the password on the page when the server asks for one and none was typed, and "Test the connection" checks the
  user and the password without running the command of the server.

### Fixed
- A job of the web UI no longer gets the terminal of the window that runs `git shuttle ui`: ssh asked for its password there, where nobody
  could tell why the page waited.
- Typing in the Modules field of the Deploy tab no longer makes the plan disappear under the cursor (the field lost the focus and the next
  keys went to the shortcuts of the page, for example the one that opens the command log).
- A test of `sync --merge` that depended on whether two commits fell in the same second no longer fails on a slow runner.

## [0.3.0] - 2026-10-22

The release with `git shuttle deploy` and the Deploy tab: after a push, one click (or one command) updates a server over ssh.

### Added
- `git shuttle deploy`: after a push, run the update command of a server over ssh, with the same preview and checks every time. A server
  (a "target": `staging`, `production`…) is saved once in the repository (`deploy --setup NAME`, a wizard like the other commands; `--list`,
  `--forget`), then `git shuttle deploy staging` is all there is to type. It fetches, refuses commits of the branch that are not on the remote,
  finds the Odoo modules that changed since the last deploy of that target (`detector=odoo`; or `--modules a,b`), shows the exact command,
  and remembers the commit it deployed. A target can ask for its name to be typed before every deploy (`--confirm NAME`; `--yes` alone does
  not deploy to it), which is the default for a release branch. `--plan [--porcelain]` and `--check` change nothing.
- The web UI has a Deploy tab with the same: servers, the plan, the modules (editable), the typed name, a preview, and the result.
- sudo on the server: `sudo=ask` means the server asks for a password. On a terminal, ssh gets a terminal and you type it at the prompt of
  sudo (git-shuttle never reads it). In the web UI the password is typed in the page, written once to the prompt on a pseudo terminal,
  and never stored: not in a command line, the environment, the history, the answer of the job or any file; if the terminal echoes it, it is
  cut out of the output, and a wrong password is not sent again.
- Connecting works like odoo-mirror: on a terminal ssh asks for the login password of the server itself, once (one shared connection for
  the check and the deploy, closed at the end), or uses your key or agent; without a terminal it never asks (BatchMode). In the web UI the
  password field of the tab answers the prompt of ssh and the one of sudo. The user is the one of the server (`odooAdmin@host`). The host and the modules are validated, so nothing from a setting or the
  page can become an ssh option or a shell command.

- The Deploy tab is made to need few steps: add a server once (name, address, user, command, branch), then one click on "Deploy to …". The
  password is typed when you deploy (one field for the ssh login and for sudo; "Keep it until I close this page" keeps it in the page only).
  "Test the connection" checks the user and the password and runs nothing. A command that is an alias of the login shell of the server is
  run in a login shell (`bash -ic`): a box in the form, or one click when the server did not find the command (exit 127).

### Changed
- API level 6 (the Deploy routes): an older server shows the "stop it and run git shuttle ui again" banner.

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
