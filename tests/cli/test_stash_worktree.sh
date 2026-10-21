#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/s; head=$(git rev-parse HEAD)

# --- stash ---------------------------------------------------------------------------------------------------------------------------
shuttle -y stash
assert_status 1 "$RC" "nothing to stash"
echo more >> file.txt; echo new > new.txt
shuttle -y stash -m "work in progress"
assert_status 0 "$RC" "stash tracked changes"
assert_eq "?? new.txt" "$(git status --porcelain)" "...new files stay"
assert_contains "$(git stash list)" "work in progress" "...with the message"
shuttle -y stash -u
assert_eq "" "$(git status --porcelain)" "--include-untracked takes the new files too"
shuttle stash list
assert_contains "$OUT" "stash@{0}" "list"
shuttle stash list --porcelain
assert_contains "$OUT" "0"$'\x1f' "...porcelain starts with the number"
shuttle stash show 1
assert_contains "$OUT" "file.txt" "show"
shuttle stash show --porcelain 1
assert_contains "$OUT" "+more" "show --porcelain is the diff"
for bad in "stash apply" "stash apply 9" "stash apply -1" "stash apply 0 1" "stash drop abc" "stash show" "stash --evil" "stash apply 0;ls"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: $bad"
done
shuttle -y stash pop 0
assert_status 0 "$RC" "pop the newest"
assert_eq "?? new.txt" "$(git status --porcelain)" "...it is back"
assert_eq "1" "$(git stash list | wc -l | tr -d ' ')" "...and gone from the list"
git add -A; git commit -q -m "[ADD] x"
shuttle -y stash apply 0
assert_status 0 "$RC" "apply keeps the stash"
assert_eq "1" "$(git stash list | wc -l | tr -d ' ')" "...it is still there"
shuttle -y stash apply 0
assert_status 1 "$RC" "apply on a dirty tree"
git checkout -q -- .
shuttle -y stash drop 0
assert_status 0 "$RC" "drop"
assert_eq "0" "$(git stash list | wc -l | tr -d ' ')" "...the list is empty"
# conflict: the stash and the tree change the same line
echo mine > file.txt; shuttle -y stash
echo theirs > file.txt; git commit -q -am "[FIX] same line"
shuttle -y stash pop 0
assert_status 2 "$RC" "a conflicting pop stops"
assert_eq "1" "$(git stash list | wc -l | tr -d ' ')" "...keeping the stash"
git checkout -q -f HEAD; git reset -q --hard
shuttle -y stash drop 0
echo p > p.txt; git add p.txt; shuttle -y stash
shuttle -y undo
assert_status 0 "$RC" "undo a stash push"
assert_eq "A  p.txt" "$(git status --porcelain)" "...the changes are back"
git reset -q --hard
echo q >> file.txt; shuttle -y stash; shuttle -y stash pop 0; shuttle -y undo
assert_status 1 "$RC" "undo of a pop is refused"
git checkout -q -- .

# --- worktree ------------------------------------------------------------------------------------------------------------------------
wt="$SB/wt-one"
shuttle -y worktree add "$wt" feat/s
assert_status 1 "$RC" "a branch that is checked out here"
shuttle -y worktree add "$wt" develop --new nothing-here
assert_status 1 "$RC" "--new from something that is not a commit"
shuttle -y worktree add "$wt" other-branch --new develop
assert_status 0 "$RC" "add a worktree with a new branch"
assert_eq "other-branch" "$(git -C "$wt" symbolic-ref --short HEAD)" "...on that branch"
shuttle worktree list
assert_contains "$OUT" "$wt" "list shows it"
shuttle worktree list --porcelain
assert_contains "$OUT" "$wt"$'\x1f'"other-branch" "...porcelain too"
assert_eq "2" "$(shuttle worktree list --porcelain >/dev/null; "$SHUTTLE" worktree list --porcelain | tr -cd '\0' | wc -c | tr -d ' ')" "...one record per worktree, no empty one"
shuttle -y worktree add "$SB/wt-two" other-branch
assert_status 1 "$RC" "a branch another worktree has"
for bad in "worktree add .git/x develop" "worktree add relative develop" "worktree add $SB/a..b develop" "worktree add /nonexistent-dir/x develop" "worktree add $SB/inside develop --new" "worktree add" "worktree wipe"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: $bad"
done
shuttle -y worktree add "$PWD/inside" feat/s
assert_status 1 "$RC" "a folder inside the repository"
shuttle -y worktree add "$PWD/.git/inside" feat/s
assert_status 1 "$RC" "a folder inside .git"
mkdir "$SB/full"; touch "$SB/full/x"
shuttle -y worktree add "$SB/full" develop --new third
assert_status 1 "$RC" "a folder that is not empty"
echo dirty > "$wt/dirty.txt"
shuttle -y worktree remove "$wt"
assert_status 1 "$RC" "remove a worktree with changes in it"
shuttle -y worktree remove "$wt" --force
assert_status 0 "$RC" "remove it with --force"
assert_eq "" "$(ls "$wt" 2>/dev/null)" "...the folder is gone"
assert_ne "" "$(git branch --list other-branch)" "...the branch stays"
shuttle -y worktree remove "$PWD"
assert_status 1 "$RC" "the main folder"
shuttle -y worktree remove "$SB/nowhere"
assert_status 1 "$RC" "not a worktree"

# --- switch --detach -----------------------------------------------------------------------------------------------------------------
shuttle -y switch --detach "$head"
assert_status 0 "$RC" "check a commit out"
assert_eq "" "$(git symbolic-ref -q --short HEAD)" "...detached"
shuttle -y switch --detach nope
assert_status 1 "$RC" "not a commit"
git checkout -q feat/s

# --- patch ---------------------------------------------------------------------------------------------------------------------------
echo patched > patched.txt; git add patched.txt; git commit -q -m "[ADD] patched"; pc=$(git rev-parse HEAD)
shuttle patch create "$pc" --to "$SB/p.patch"
assert_status 0 "$RC" "create a patch file"
assert_contains "$(cat "$SB/p.patch")" "[ADD] patched" "...with the message"
shuttle patch create "$pc" --to "$SB/p.patch"
assert_status 1 "$RC" "...not over an existing file"
shuttle patch create nope
assert_status 1 "$RC" "patch of something that is not a commit"
git checkout -q -b elsewhere develop
shuttle -y patch apply "$SB/p.patch"
assert_status 0 "$RC" "apply it on another branch"
assert_eq "patched" "$(cat patched.txt)" "...the file is there"
assert_eq "[ADD] patched" "$(git log -1 --format=%s)" "...as a commit"
shuttle -y patch apply "$SB/p.patch"
assert_status 1 "$RC" "applying it twice says nothing is left to apply"
git checkout -q feat/s; echo one > clash.txt; git add clash.txt; git commit -q -m "[ADD] clash"; cc=$(git rev-parse HEAD)
echo two > clash.txt; git commit -q -am "[FIX] clash"
shuttle patch create HEAD --to "$SB/clash.patch"
git checkout -q -b clashing "$cc"; echo three > clash.txt; git commit -q -am "[FIX] other clash"
shuttle -y patch apply "$SB/clash.patch"
assert_status 2 "$RC" "a patch that conflicts stops"
shuttle -y abort
assert_status 0 "$RC" "...and can be given up"
assert_eq "three" "$(cat clash.txt)" "...leaving the file as it was"
git checkout -q elsewhere
shuttle -y patch apply "$SB/missing.patch"
assert_status 1 "$RC" "a file that is not there"
head -c 5300000 /dev/zero > "$SB/big.patch"
shuttle -y patch apply "$SB/big.patch"
assert_status 1 "$RC" "a file over 5 MB"
git checkout -q develop
shuttle -y patch apply "$SB/p.patch"
assert_status 1 "$RC" "a protected branch"

finish
