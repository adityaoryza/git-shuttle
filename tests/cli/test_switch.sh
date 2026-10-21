#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/a; git push -q origin feat/a
git checkout -q main

# --- a local branch ------------------------------------------------------------------------------------------------
shuttle -y switch feat/a
assert_status 0 "$RC" "switch to a local branch"
assert_eq "feat/a" "$(git branch --show-current)" "...is on it"
shuttle -y switch feat/a
assert_status 0 "$RC" "switch to the branch you are on"
assert_contains "$OUT" "already on" "...says so"

# --- a branch that only the remote has -------------------------------------------------------------------------------
remote_commit develop only/remote.txt x "remote only"
git -C "$REMOTE" branch remote-only develop
git fetch -q origin
shuttle -y switch origin/remote-only
assert_status 0 "$RC" "switch to a remote-only branch (written with the remote name)"
assert_eq "remote-only" "$(git branch --show-current)" "...a local copy is made"
assert_eq "origin/remote-only" "$(git rev-parse --abbrev-ref 'remote-only@{upstream}')" "...and it tracks the remote branch"

# --- refusals ---------------------------------------------------------------------------------------------------------
shuttle -y switch nowhere
assert_status 1 "$RC" "a branch that does not exist"
assert_contains "$OUT" "no branch 'nowhere'" "...is named"
shuttle -y switch
assert_status 1 "$RC" "no branch given"
shuttle -y switch a b
assert_status 1 "$RC" "two branches"
shuttle -y switch -x
assert_status 1 "$RC" "an option that does not exist"
shuttle -y switch 'bad..name'
assert_status 1 "$RC" "an invalid branch name"

git checkout -q main
echo "dirty" > file.txt
shuttle -y switch develop
assert_status 1 "$RC" "uncommitted changes that git would lose"
assert_eq "main" "$(git branch --show-current)" "...stay where they are, nothing moved"
git checkout -q -- file.txt

# --- a rebase waiting ----------------------------------------------------------------------------------------------------
git checkout -q -b clash1 main; echo a > clash.txt; git add clash.txt; git commit -q -m a
git checkout -q -b clash2 main; echo b > clash.txt; git add clash.txt; git commit -q -m b
git rebase clash1 >/dev/null 2>&1
shuttle -y switch main
assert_status 1 "$RC" "refused while a rebase waits"
git rebase --abort >/dev/null 2>&1

finish
