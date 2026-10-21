#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
stashes() { git stash list | wc -l | tr -d ' '; }
git checkout -q -b feature/current develop
echo "work" >> file.txt

# --- the default is to refuse -------------------------------------------------------------------------------------------------
shuttle -y start "Another task"
assert_status 1 "$RC" "uncommitted changes to tracked files stop start"
assert_contains "$OUT" "uncommitted changes" "...and say so"
assert_eq "feature/current" "$(git branch --show-current)" "...nothing moved"
assert_eq "0" "$(stashes)" "...and nothing was stashed"

# --- new files are not in the way -----------------------------------------------------------------------------------------------
git checkout -q -- file.txt
echo "new" > untracked.txt
shuttle -y start "Only a new file"
assert_status 0 "$RC" "untracked files do not stop start"
assert_eq "feature/only_a_new_file" "$(git branch --show-current)" "...the branch is made"
assert_eq "new" "$(cat untracked.txt)" "...and the file stays"
rm untracked.txt; git checkout -q feature/current

# --- --stash -------------------------------------------------------------------------------------------------------------------------------
echo "work" >> file.txt
echo "new" > untracked.txt
shuttle -y start "Stashed task" --stash
assert_status 0 "$RC" "--stash with changes"
assert_eq "feature/stashed_task" "$(git branch --show-current)" "...the branch is made"
assert_eq "1" "$(stashes)" "...one stash entry"
assert_contains "$(git stash list)" "feature/current" "...named after the branch you left"
assert_contains "$(git stash list)" "feature/stashed_task" "...and the one you started"
assert_eq "" "$(git status --porcelain --untracked-files=no)" "...the tracked changes are gone from the tree"
assert_eq "new" "$(cat untracked.txt)" "...new files stay"
assert_contains "$OUT" "git stash pop" "...it says how to bring the changes back"
git stash pop -q
assert_contains "$(cat file.txt)" "work" "...and they do come back"
git checkout -q -- file.txt; rm -f untracked.txt; git checkout -q feature/current

# --- --stash with nothing to stash -----------------------------------------------------------------------------------------------------
shuttle -y start "Clean stash" --stash
assert_status 0 "$RC" "--stash on a clean tree"
assert_eq "0" "$(stashes)" "...stashes nothing"
git checkout -q feature/current
echo "new" > untracked.txt
shuttle -y start "Only new stash" --stash
assert_status 0 "$RC" "--stash with only a new file"
assert_eq "0" "$(stashes)" "...stashes nothing"
rm -f untracked.txt; git checkout -q feature/current

# --- --carry -------------------------------------------------------------------------------------------------------------------------------
echo "carried" > carried.txt; git add carried.txt
shuttle -y start "Carried task" --carry
assert_status 0 "$RC" "--carry with a change that does not conflict"
assert_eq "feature/carried_task" "$(git branch --show-current)" "...the branch is made"
assert_eq "carried" "$(cat carried.txt)" "...the change came along"
assert_eq "A  carried.txt" "$(git status --porcelain)" "...still staged"
assert_eq "0" "$(stashes)" "...no stash"
git reset -q HEAD carried.txt; rm carried.txt; git checkout -q feature/current

# a change that the new branch's start point cannot take: develop has a different file.txt than main
git checkout -q main
echo "conflicting" > file.txt
before=$(git rev-parse HEAD)
shuttle -y start "Conflicting task" --carry
assert_status 1 "$RC" "--carry with a conflict"
assert_contains "$OUT" "conflict" "...says so"
assert_eq "main" "$(git branch --show-current)" "...still on the branch you were on"
assert_eq "conflicting" "$(cat file.txt)" "...with your change"
assert_eq "$before" "$(git rev-parse HEAD)" "...and nothing moved"
assert_eq "" "$(git branch --list feature/conflicting_task)" "...no branch was made"
assert_eq "0" "$(stashes)" "...no stash"
shuttle -y start "Conflicting task" --stash
assert_status 0 "$RC" "the same change with --stash works"
assert_eq "1" "$(stashes)" "...and is in the stash"
git stash drop -q; git checkout -q main

# --- both flags, an existing branch, a dry run -----------------------------------------------------------------------------------------
shuttle -y start "Both" --stash --carry
assert_status 1 "$RC" "--stash and --carry together"
assert_contains "$OUT" "cannot be used together" "...say why"
echo "work" >> file.txt
git branch feature/taken develop
shuttle -y start "Taken" --stash
assert_status 1 "$RC" "a branch that exists"
assert_contains "$OUT" "already exists" "...is named"
assert_eq "0" "$(stashes)" "...and refused before anything was stashed"
assert_contains "$(cat file.txt)" "work" "...your change is where it was"

shuttle -n start "Dry run" --stash
assert_status 0 "$RC" "--dry-run with --stash"
assert_contains "$OUT" "git stash push" "...shows the stash"
assert_contains "$OUT" "git checkout --no-track -b feature/dry_run" "...and the checkout"
assert_eq "0" "$(stashes)" "...but changes nothing"
assert_eq "" "$(git branch --list feature/dry_run)" "...no branch"
shuttle -n start "Dry run" --carry
assert_status 0 "$RC" "--dry-run with --carry"
assert_not_contains "$OUT" "git stash" "...does not mention the stash"
git checkout -q -- file.txt

finish
