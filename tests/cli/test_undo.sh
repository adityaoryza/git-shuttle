#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/u
branch_now() { git branch --show-current; }

# --- nothing yet ------------------------------------------------------------------------------------------------------------------
shuttle -y undo
assert_status 1 "$RC" "undo with an empty journal"
assert_contains "$OUT" "nothing to undo" "...says so"
shuttle -y redo
assert_status 1 "$RC" "redo with nothing undone"

# --- switch, undo, redo -----------------------------------------------------------------------------------------------------------
shuttle -y switch main
assert_eq "main" "$(branch_now)" "switch to main"
shuttle journal
assert_contains "$OUT" "switch" "the journal lists it"
assert_contains "$OUT" "HEAD feat/u->main" "...with what changed"
shuttle -y undo
assert_status 0 "$RC" "undo the switch"
assert_eq "feat/u" "$(branch_now)" "...back on the branch"
shuttle -y redo
assert_status 0 "$RC" "redo it"
assert_eq "main" "$(branch_now)" "...on main again"
shuttle -y redo
assert_status 1 "$RC" "a second redo has nothing to do"
shuttle -y undo >/dev/null

# --- a branch made, then taken back ------------------------------------------------------------------------------------------------
shuttle -y branch feat/made develop
assert_eq "feat/made" "$(branch_now)" "branch made and switched to"
shuttle -y undo
assert_eq "feat/u" "$(branch_now)" "undo goes back to where you were"
assert_eq "" "$(git branch --list feat/made)" "...and the branch is gone"
shuttle -y redo
assert_eq "feat/made" "$(branch_now)" "redo makes it again"
assert_eq "$(git rev-parse develop)" "$(git rev-parse feat/made)" "...at the same commit"
shuttle -y undo >/dev/null; git checkout -q feat/u

# --- a commit is taken back, its changes stay -----------------------------------------------------------------------------------------
echo more >> feat/u.txt
shuttle -y commit -m "[FIX] u: more" -- feat/u.txt
tip=$(git rev-parse HEAD)
shuttle -y undo
assert_status 0 "$RC" "undo a commit"
assert_eq "feat/u" "$(git rev-parse HEAD~0 >/dev/null && git rev-parse --abbrev-ref HEAD)" "...still on the branch"
assert_ne "$tip" "$(git rev-parse HEAD)" "...the branch is one commit back"
assert_contains "$(git diff --cached --name-only)" "feat/u.txt" "...and the change is staged again, nothing is lost"
assert_contains "$(cat feat/u.txt)" "more" "...in the file too"
git checkout -q -- . 2>/dev/null; git reset -q --hard HEAD

# --- the reasons it refuses ----------------------------------------------------------------------------------------------------------------
shuttle -y switch main
git checkout -q feat/u              # a change made outside git-shuttle: the journal no longer matches
shuttle -y undo
assert_status 1 "$RC" "undo after something else moved you"
assert_contains "$OUT" "not on the branch the change left you on" "...says why"
git checkout -q main
shuttle -y undo >/dev/null 2>&1 || true
git checkout -q feat/u

shuttle -y branch feat/pushed develop
git push -q -u origin feat/pushed
echo x >> feat/pushed.txt 2>/dev/null; echo x > pushed.txt; git add pushed.txt
shuttle -y commit -m "[ADD] pushed: a file" -- pushed.txt
git push -q origin feat/pushed
shuttle -y undo
assert_status 1 "$RC" "undo of a commit that was pushed"
assert_contains "$OUT" "pushed history" "...says why"
assert_eq "[ADD] pushed: a file" "$(git log -1 --format=%s)" "...and the commit is still there"

shuttle -y switch feat/u
echo dirty >> feat/u.txt
shuttle -y undo
assert_status 1 "$RC" "undo with uncommitted changes"
assert_contains "$OUT" "uncommitted changes" "...says so"
git checkout -q -- feat/u.txt

# --- a dry run changes nothing ---------------------------------------------------------------------------------------------------------------
before=$(branch_now)
shuttle -y switch main
shuttle -n undo
assert_status 0 "$RC" "a dry-run undo"
assert_contains "$OUT" "git checkout" "...shows the commands"
assert_eq "main" "$(branch_now)" "...and changes nothing"
shuttle -y undo >/dev/null
assert_eq "$before" "$(branch_now)" "the real undo does"

# --- a new change ends the redo ----------------------------------------------------------------------------------------------------------------
shuttle -y switch main; shuttle -y undo >/dev/null
shuttle -y switch develop
shuttle -y redo
assert_status 1 "$RC" "after a new change there is nothing to redo"

# --- the journal is kept small and per repository -------------------------------------------------------------------------------------------------
for _ in $(seq 1 12); do shuttle -y switch main >/dev/null; shuttle -y switch develop >/dev/null; done
lines=$(wc -l < "$(git rev-parse --git-common-dir)/shuttle-journal" | tr -d ' ')
assert_eq "yes" "$([[ $lines -le 100 ]] && echo yes || echo no)" "the journal keeps at most 100 entries"
shuttle journal --porcelain
assert_contains "$(printf '%s' "$OUT" | tr '\0' '\n')" "switch" "porcelain output for programs"

finish
