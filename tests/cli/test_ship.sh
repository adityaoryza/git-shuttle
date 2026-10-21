#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
dev_tip() { git -C "$REMOTE" rev-parse develop; }

# --- commit and ship in one go ------------------------------------------------------------------------------------------
git checkout -q -b feat/ship develop
echo one > a.txt; git add a.txt
shuttle -y ship -m "add a"
assert_status 0 "$RC" "ship with a message"
assert_eq "feat/ship" "$(git branch --show-current)" "...ends on the feature branch"
assert_eq "Merge branch 'feat/ship' into develop" "$(remote_log develop | head -1)" "...the integration branch got the merge"
assert_contains "$(remote_log develop | head -3)" "add a" "...with the commit in it"
assert_eq "add a" "$(remote_log feat/ship | head -1)" "...and the feature branch is on the remote"

# --- ship what is already committed -------------------------------------------------------------------------------------------
git checkout -q -b feat/ship2 develop
echo two > b.txt; git add b.txt; git commit -q -m "add b"
shuttle -y ship
assert_status 0 "$RC" "ship without a message: the commits the branch already has"
assert_contains "$(remote_log develop | head -3)" "add b" "...are merged"
shuttle -y ship
assert_status 0 "$RC" "ship again, nothing new"
assert_contains "$OUT" "nothing to merge" "...says so"

# --- everything that can be refused is refused before the first change -----------------------------------------------------------
git checkout -q -b feat/ship3 develop
echo three > c.txt; git add c.txt
before=$(dev_tip); head_before=$(git rev-parse HEAD)
git config shuttle.messagePattern '^\[[A-Z]+\] .+'
shuttle -y ship -m "no tag"
assert_status 1 "$RC" "ship with a message that breaks the rule"
assert_eq "$head_before" "$(git rev-parse HEAD)" "...no commit was made"
assert_eq "$before" "$(dev_tip)" "...and nothing was pushed"
git config --unset shuttle.messagePattern
shuttle -y ship -m "x" -- nothing.txt
assert_status 1 "$RC" "ship with a path that has no changes"
git reset -q; rm -f c.txt
shuttle -y ship -m "nothing staged"
assert_status 1 "$RC" "ship with nothing staged"
assert_contains "$OUT" "nothing is staged" "...says so"
echo dirty > d.txt; git add d.txt
shuttle -y ship
assert_status 1 "$RC" "ship without a message while files are staged"
assert_contains "$OUT" "uncommitted changes" "...is refused: commit them or give -m"
git reset -q; rm -f d.txt
shuttle -y ship -- a.txt
assert_status 1 "$RC" "paths without a message"
git checkout -q develop
shuttle -y ship
assert_status 1 "$RC" "ship on a protected branch"
git checkout -q feat/ship3

# --- one question, not two ------------------------------------------------------------------------------------------------------
echo four > e.txt; git add e.txt
with_tty "" "$SHUTTLE" ship -m "add e"
assert_status 0 "$RC" "ship at a terminal, one Enter"
assert_eq "1" "$(grep -c '\[Y/n\]' <<<"$OUT")" "...it asked once"
assert_contains "$(remote_log develop | head -3)" "add e" "...and the commit got to the integration branch"
git checkout -q -b feat/ship4 develop; echo five > f.txt; git add f.txt
before=$(dev_tip)
with_tty n "$SHUTTLE" ship -m "add f"
assert_status 3 "$RC" "ship, answering n"
assert_eq "$before" "$(dev_tip)" "...nothing reached the remote"
assert_eq "A  f.txt" "$(git status --short | grep f.txt)" "...and nothing was committed: the file is still staged"
shuttle -n ship -m "add f"
assert_status 0 "$RC" "ship --dry-run"
assert_contains "$OUT" "git commit" "...shows the commands"
assert_eq "$before" "$(dev_tip)" "...and changes nothing"
shuttle -y ship -m "add f" -- f.txt
assert_status 0 "$RC" "ship with a path"
assert_contains "$(remote_log develop | head -3)" "add f" "...merged"
shuttle -y ship --bogus
assert_status 1 "$RC" "an unknown option"
shuttle -y ship --allow-protected
assert_status 1 "$RC" "ship never takes --allow-protected"

finish
