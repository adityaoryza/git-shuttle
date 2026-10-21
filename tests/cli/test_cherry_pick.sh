#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/src a.txt
echo two > b.txt; git add b.txt; git commit -q -m "second"
C1=$(git rev-parse HEAD~1); C2=$(git rev-parse HEAD)
feature feat/target t.txt

# --- cherry-pick ----------------------------------------------------------------------------------------------------
shuttle -y cherry-pick "$C1" "$C2"
assert_status 0 "$RC" "two commits onto the current branch"
assert_eq "second" "$(git log -1 --format=%s)" "...the last one is on top"
assert_eq "work on feat/src" "$(git log -1 --format=%s HEAD~1)" "...in the order given"
shuttle -y cherry-pick "$C1"
assert_status 0 "$RC" "the same change again (a new commit would be empty)"
assert_contains "$OUT" "would change nothing" "...is skipped, not left half done"
assert_eq "" "$(git ls-files -u)" "...and nothing waits to be finished"
shuttle -y cherry-pick "$(git rev-parse develop)"
assert_status 1 "$RC" "a commit that is already in the branch's history"
assert_contains "$OUT" "already in" "...is skipped, and there is nothing left to do"
shuttle -n cherry-pick "$C1" "$C2" nope
assert_status 1 "$RC" "a commit that does not exist"
assert_contains "$OUT" "not a commit" "...is named"

# --- refusals ---------------------------------------------------------------------------------------------------------
git checkout -q develop
shuttle -y cherry-pick "$C1"
assert_status 1 "$RC" "a protected branch"
assert_contains "$OUT" "protected" "...says why"
git checkout -q -b merge-target develop
git merge -q --no-ff -m "merge feat" feat/src
MERGE=$(git rev-parse HEAD)
git checkout -q feat/target
shuttle -y cherry-pick "$MERGE"
assert_status 1 "$RC" "a merge commit"
shuttle -y cherry-pick
assert_status 1 "$RC" "no commit given"
echo dirty >> t.txt
shuttle -y cherry-pick "$MERGE"
assert_status 1 "$RC" "a dirty tree"
git checkout -q -- t.txt

# --- a conflict ----------------------------------------------------------------------------------------------------------
git checkout -q -b left develop; echo left > clash.txt; git add clash.txt; git commit -q -m left
git checkout -q -b right develop; echo right > clash.txt; git add clash.txt; git commit -q -m right
RIGHT=$(git rev-parse HEAD)
git checkout -q left
shuttle -y cherry-pick "$RIGHT"
assert_status 2 "$RC" "a conflict stops half way"
assert_contains "$OUT" "git shuttle continue" "...with the way to go on"
echo resolved > clash.txt
shuttle -y continue
assert_status 0 "$RC" "continue finishes the cherry-pick"
assert_eq "right" "$(git log -1 --format=%s)" "...with the commit's own message"

# --- branch ---------------------------------------------------------------------------------------------------------------------
shuttle -y branch from/here "$C1"
assert_status 0 "$RC" "a branch at a commit"
assert_eq "from/here" "$(git branch --show-current)" "...is switched to"
assert_eq "$C1" "$(git rev-parse HEAD)" "...and points at that commit"
shuttle -y branch from/here
assert_status 1 "$RC" "a name that exists"
shuttle -y branch "bad..name"
assert_status 1 "$RC" "an invalid name"
shuttle -y branch ok/name nope
assert_status 1 "$RC" "a commit that does not exist"
shuttle -y branch
assert_status 1 "$RC" "no name"

finish
