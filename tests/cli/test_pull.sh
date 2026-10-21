#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/pl; git push -q -u origin feat/pl

# --- fetch ------------------------------------------------------------------------------------------------------------------------
remote_commit feat/pl theirs.txt 1 "their work"
shuttle -y fetch
assert_status 0 "$RC" "fetch"
assert_eq "$(git -C "$REMOTE" rev-parse feat/pl)" "$(git rev-parse origin/feat/pl)" "...the remote branch is up to date"
assert_ne "$(git rev-parse origin/feat/pl)" "$(git rev-parse feat/pl)" "...yours did not move"
git -C "$REMOTE" branch gone-soon main; shuttle -y fetch; git -C "$REMOTE" branch -D -q gone-soon
shuttle -y fetch
assert_ne "" "$(git branch -r --list origin/gone-soon)" "a branch deleted on the remote is kept by a plain fetch"
shuttle -y fetch --prune
assert_eq "" "$(git branch -r --list origin/gone-soon)" "...and removed by --prune"
shuttle -y fetch --all
assert_status 0 "$RC" "fetch --all"
shuttle -y fetch --nope
assert_status 1 "$RC" "an unknown option"
shuttle -n fetch --prune
assert_contains "$OUT" "git fetch --quiet --prune origin" "a dry run shows the command"

# --- pull, fast-forward --------------------------------------------------------------------------------------------------------------
shuttle -y pull
assert_status 0 "$RC" "pull a branch that is behind"
assert_eq "$(git rev-parse origin/feat/pl)" "$(git rev-parse feat/pl)" "...moves it forward"
assert_contains "$OUT" "moved forward by 1" "...and says by how much"
shuttle -y pull
assert_status 0 "$RC" "pull when there is nothing new"
assert_contains "$OUT" "already up to date" "...says so"

# --- diverged: ff-only refuses, --rebase replays ------------------------------------------------------------------------------------
echo mine >> feat/pl.txt; git commit -q -am "my work"
remote_commit feat/pl theirs2.txt 2 "their second work"
shuttle -y pull
assert_status 1 "$RC" "ff-only pull of a diverged branch"
assert_contains "$OUT" "diverged" "...explains"
shuttle -n pull --rebase
assert_contains "$OUT" "replays:    1 commit(s)" "a dry-run --rebase says how many commits it replays"
assert_contains "$OUT" "git rebase origin/feat/pl" "...and the command"
shuttle -y pull --rebase
assert_status 0 "$RC" "pull --rebase"
assert_eq "my work" "$(git log -1 --format=%s)" "...your commit is on top"
assert_eq "their second work" "$(git log -1 --format=%s HEAD~1)" "...of theirs"

# --- refusals --------------------------------------------------------------------------------------------------------------------------
echo dirty >> feat/pl.txt
shuttle -y pull
assert_status 1 "$RC" "pull with uncommitted changes"
git checkout -q -- feat/pl.txt
git checkout -q -b no-upstream
shuttle -y pull
assert_status 1 "$RC" "a branch with no upstream"
assert_contains "$OUT" "no upstream" "...says so"
git checkout -q develop
remote_commit develop dev.txt 3 "dev news"
shuttle -y pull --rebase
assert_status 1 "$RC" "pull --rebase on a protected branch"
shuttle -y pull
assert_status 0 "$RC" "a plain pull of a protected branch is fine"
assert_contains "$(git log -1 --format=%s)" "dev news" "...and brings the news"

# --- conflicts leave a rebase to finish --------------------------------------------------------------------------------------------------
git checkout -q feat/pl; echo local > clash.txt; git add clash.txt; git commit -q -m "local clash"
remote_commit feat/pl clash.txt remote "remote clash"
shuttle -y pull --rebase
assert_status 2 "$RC" "a conflict while pulling with a rebase"
assert_contains "$OUT" "git shuttle continue" "...says how to go on"
shuttle -y abort >/dev/null

# --- sync --merge and the numbers a dry run shows -----------------------------------------------------------------------------------------
git checkout -q -b feat/m develop
echo m > m.txt; git add m.txt; git commit -q -m "m work"
remote_commit develop news2.txt 4 "more dev news"
shuttle -y fetch
shuttle -n sync
assert_contains "$OUT" "replays:    1 commit(s) of 'feat/m' on top of origin/develop (1 new)" "a dry-run sync says how many commits are replayed"
shuttle -y sync --merge
assert_status 0 "$RC" "sync --merge"
assert_contains "$(git log -1 --format=%s)" "Merge remote-tracking branch 'origin/develop'" "...makes a merge commit instead of a rebase"
assert_eq "m work" "$(git log --format=%s --no-merges -1)" "...and keeps your commit as it was"
shuttle -y sync --merge
assert_contains "$OUT" "nothing to merge" "a second time there is nothing to do"

# --- pull --merge, and updating another branch without checking it out ---------------------------------------------------------------
git checkout -q -b feat/pm develop; echo pm > pm.txt; git add pm.txt; git commit -q -m "pm work"; git push -q -u origin feat/pm
remote_commit feat/pm theirs-pm.txt 1 "their pm work"
echo mine > mine.txt; git add mine.txt; git commit -q -m "my pm work"
shuttle -y pull --merge
assert_status 0 "$RC" "pull --merge with commits on both sides"
assert_contains "$(git log -1 --format=%s)" "Merge" "...makes a merge commit"
assert_ne "" "$(git log --format=%s | grep "their pm work")" "...with their commit in it"
shuttle -y pull --merge
assert_contains "$OUT" "already up to date" "...a second time there is nothing to do"
git checkout -q develop
remote_commit develop dev-news.txt 1 "news on develop"
shuttle -y pull --merge
assert_status 1 "$RC" "pull --merge on a protected branch that is behind"
assert_contains "$OUT" "protected" "...says why"
git checkout -q main
remote_commit feat/pl later.txt 1 "later work"
git branch -f feat/pl-ref origin/feat/pl 2>/dev/null; git branch -q --track other-one origin/feat/pl 2>/dev/null; git branch -f other-one "$(git rev-parse origin/feat/pl~1)"
git branch -q --set-upstream-to=origin/feat/pl other-one
before=$(git rev-parse HEAD); branch_before=$(git symbolic-ref --short HEAD)
shuttle -y pull --branch other-one
assert_status 0 "$RC" "update another branch without checking it out"
assert_eq "$(git rev-parse origin/feat/pl)" "$(git rev-parse other-one)" "...it is at the remote"
assert_eq "$before" "$(git rev-parse HEAD)" "...the checked out branch did not move"
assert_eq "$branch_before" "$(git symbolic-ref --short HEAD)" "...and is the same one"
shuttle -y pull --branch other-one
assert_contains "$OUT" "already up to date" "...again: nothing to do"
git checkout -q -b diverge other-one; echo d > d.txt; git add d.txt; git commit -q -m "diverged"; git checkout -q main
git branch -q -f other-two diverge; git branch -q --set-upstream-to=origin/feat/pl other-two
remote_commit feat/pl more.txt 1 "more work"
shuttle -y pull --branch other-two
assert_status 1 "$RC" "a diverged branch is not moved"
assert_contains "$OUT" "diverged" "...says why"
for bad in "pull --branch" "pull --branch nope" "pull --branch -x" "pull --branch main" "pull --branch other-one --rebase" "pull --branch a..b"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: $bad"
done
git branch -q lonely develop
shuttle -y pull --branch lonely
assert_status 1 "$RC" "a branch with no upstream"
git worktree add -q "$SB/wt-pull" other-one
shuttle -y pull --branch other-one
assert_status 1 "$RC" "a branch another worktree has checked out"
git worktree remove --force "$SB/wt-pull"

finish
