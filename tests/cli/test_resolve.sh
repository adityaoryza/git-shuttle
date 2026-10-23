#!/usr/bin/env bash
# shellcheck disable=SC2034  # PJ is read by pj, which is in sandbox.sh
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
conflict_on_develop() { # a rebase that stops: feature and develop both change clash.txt (a new text each time)
    git checkout -q -b "$1" develop; echo "mine $1" > clash.txt; git add clash.txt; git commit -q -m "mine $1"
    remote_commit develop clash.txt "theirs $1" "theirs $1"
}
unmerged() { git diff --name-only --diff-filter=U; }

# --- nothing waits ------------------------------------------------------------------------------------------------------------------------
shuttle -y resolve --ours -- clash.txt
assert_status 1 "$RC" "resolve with nothing waiting"
assert_contains "$OUT" "nothing is waiting" "...says so"
PJ=$(porcelain_json status --porcelain)
assert_eq "" "$(pj conflict.ours)" "status: no sides when nothing waits"

# --- a rebase: ours and theirs are the other way round -------------------------------------------------------------------------------------
conflict_on_develop feat/r1
shuttle -y sync
assert_status 2 "$RC" "a rebase that stops"
PJ=$(porcelain_json status --porcelain)
assert_eq "origin/develop" "$(pj conflict.ours)" "rebase: 'ours' is what you rebase onto"
assert_eq "what you rebase onto" "$(pj conflict.ours.role)" "...and says so"
assert_eq "feat/r1" "$(pj conflict.theirs)" "rebase: 'theirs' is your own branch"
assert_eq "your own work, being replayed" "$(pj conflict.theirs.role)" "...and says so"

# the refusals
shuttle -y resolve -- clash.txt
assert_status 1 "$RC" "no side given"
shuttle -y resolve --ours --theirs -- clash.txt
assert_status 1 "$RC" "both sides given"
shuttle -y resolve --ours
assert_status 1 "$RC" "no file given"
shuttle -y resolve --ours -- file.txt
assert_status 1 "$RC" "a file that is not in conflict"
assert_contains "$OUT" "is not in conflict" "...says so"
shuttle -y resolve --ours -- '*'
assert_status 1 "$RC" "a pattern is a name, and no file in conflict has it"
shuttle -y resolve --ours -- ''
assert_status 1 "$RC" "an empty name"
shuttle -y resolve --mine -- clash.txt
assert_status 1 "$RC" "an option that does not exist"
assert_eq "clash.txt" "$(unmerged)" "...nothing was changed by the refusals"

# a dry run shows what it would do, and changes nothing
shuttle -n resolve --theirs -- clash.txt
assert_status 0 "$RC" "resolve --dry-run"
assert_contains "$OUT" "git checkout --theirs -- clash.txt" "...shows the command"
assert_contains "$OUT" "keep:       feat/r1" "...says which branch is kept"
assert_contains "$OUT" "dropped:    what origin/develop" "...and which one is dropped"
assert_eq "clash.txt" "$(unmerged)" "...and the file is still in conflict"

# keeping your own work in a rebase is --theirs
shuttle -y resolve --theirs -- clash.txt
assert_status 0 "$RC" "keep the work of the branch (a rebase: --theirs)"
assert_eq "mine feat/r1" "$(cat clash.txt)" "...the file has your text"
assert_eq "" "$(unmerged)" "...and is no longer in conflict"
assert_contains "$OUT" "git shuttle continue" "...says what comes next"
shuttle -y continue
assert_status 0 "$RC" "continue finishes the rebase"
assert_eq "mine feat/r1" "$(cat clash.txt)" "...with your text kept"

# what the output tells to do to take it back
conflict_on_develop feat/r2
shuttle -y sync
shuttle -y resolve --ours -- clash.txt
assert_eq "theirs feat/r2" "$(cat clash.txt)" "keep what you rebase onto (a rebase: --ours)"
git checkout --merge -- clash.txt
assert_contains "$(cat clash.txt)" "<<<<<<<" "git checkout --merge -- FILE brings the conflict back, as the output says"
assert_eq "clash.txt" "$(unmerged)" "...and the file is in conflict again"
shuttle -y abort

# --- a merge: ours is the branch you are on ------------------------------------------------------------------------------------------------
git checkout -q -b m1 develop; echo "mine m1" > clash.txt; git add clash.txt; git commit -q -m "m1 work"
git checkout -q -b m2 develop; echo "other m2" > clash.txt; git add clash.txt; git commit -q -m "m2 work"
git checkout -q m1
git merge m2 >/dev/null 2>&1
PJ=$(porcelain_json status --porcelain)
assert_eq "merge" "$(pj operation)" "a merge that stops"
assert_eq "m1" "$(pj conflict.ours)" "merge: 'ours' is the branch you are on"
assert_eq "m2" "$(pj conflict.theirs)" "merge: 'theirs' is the branch you merge in"
shuttle -y resolve --theirs -- clash.txt
assert_eq "other m2" "$(cat clash.txt)" "keep the branch that is merged in"
shuttle -y continue
assert_status 0 "$RC" "continue makes the merge commit"
assert_eq "other m2" "$(cat clash.txt)" "...with that text"

# --- a cherry-pick: theirs is the commit ---------------------------------------------------------------------------------------------------
git checkout -q -b c1 develop; echo "mine c1" > clash.txt; git add clash.txt; git commit -q -m "c1 work"
git checkout -q -b c2 develop; echo "picked c2" > clash.txt; git add clash.txt; git commit -q -m "c2 work"
pick=$(git rev-parse --short HEAD)
git checkout -q c1
git cherry-pick c2 >/dev/null 2>&1
PJ=$(porcelain_json status --porcelain)
assert_eq "cherry-pick" "$(pj operation)" "a cherry-pick that stops"
assert_eq "c1" "$(pj conflict.ours)" "cherry-pick: 'ours' is the branch you are on"
assert_eq "$pick c2 work" "$(pj conflict.theirs)" "cherry-pick: 'theirs' is the commit, with its hash and its title"
shuttle -y resolve --ours -- clash.txt
assert_eq "mine c1" "$(cat clash.txt)" "keep the branch you are on"
shuttle -y abort

# --- a side that deleted the file keeps it deleted -----------------------------------------------------------------------------------------
git checkout -q -b d1 develop; git rm -q file.txt; git commit -q -m "delete file.txt"
remote_commit develop file.txt "changed upstream" "touch file.txt"
shuttle -y sync
assert_status 2 "$RC" "a rebase: one side changed the file, the other deleted it"
assert_eq "file.txt" "$(unmerged)" "...the file is in conflict"
shuttle -n resolve --theirs -- file.txt
assert_contains "$OUT" "git rm -q -- file.txt" "taking the deleting side: the dry run says it deletes"
assert_contains "$OUT" "that side deleted it" "...and why"
shuttle -y resolve --theirs -- file.txt
assert_status 0 "$RC" "keep the side that deleted it"
assert_eq "no" "$([[ -e file.txt ]] && echo yes || echo no)" "...the file is gone"
assert_eq "" "$(unmerged)" "...and is no longer in conflict"
shuttle -y continue
assert_status 0 "$RC" "continue finishes it"
assert_eq "no" "$([[ -e file.txt ]] && echo yes || echo no)" "...the file stays deleted"

git checkout -q -b d2 develop
git rm -q file.txt 2>/dev/null; git commit -q -m "delete file.txt again"
remote_commit develop file.txt "changed upstream again" "touch file.txt again"
shuttle -y sync
shuttle -y resolve --ours -- file.txt
assert_status 0 "$RC" "keep the side that changed it"
assert_eq "changed upstream again" "$(cat file.txt)" "...the file has that text"
shuttle -y abort

finish
