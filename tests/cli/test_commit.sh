#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/c
heads() { git rev-parse HEAD; }

# --- the plain case ----------------------------------------------------------------------------------------------
echo one > a.txt; git add a.txt
shuttle -y commit -m "add a"
assert_status 0 "$RC" "a commit of what is staged"
assert_eq "add a" "$(git log -1 --format=%s)" "...with the message"
assert_contains "$OUT" "repository: my work" "...shows the repository before it acts"

# --- refusals change nothing --------------------------------------------------------------------------------------
before=$(heads)
shuttle -y commit -m "nothing here"
assert_status 1 "$RC" "nothing staged"
assert_contains "$OUT" "nothing is staged" "...says so"
assert_eq "$before" "$(heads)" "...and no commit was made"

shuttle -y commit
assert_status 1 "$RC" "no message"
assert_contains "$OUT" "needs a message" "...asks for one"

echo two > b.txt; git add b.txt
git checkout -q develop 2>/dev/null; echo two > b.txt; git add b.txt
shuttle -y commit -m "on a protected branch"
assert_status 1 "$RC" "a commit on a protected branch"
assert_contains "$OUT" "protected branch" "...is refused"
git reset -q; rm -f b.txt; git checkout -q feat/c

git checkout -q --detach; echo two > b.txt; git add b.txt
shuttle -y commit -m "detached"
assert_status 1 "$RC" "a commit on a detached HEAD"
git reset -q; rm -f b.txt; git checkout -q feat/c

# --- paths: only those are committed ----------------------------------------------------------------------------
echo p1 > p1.txt; echo p2 > p2.txt; git add p1.txt p2.txt
shuttle -y commit -m "only p1" -- p1.txt
assert_status 0 "$RC" "a commit with a path"
assert_eq "p1.txt" "$(git show --name-only --format= HEAD)" "...holds only that file"
assert_eq "A  p2.txt" "$(git status --short | grep p2)" "...and what else was staged stays staged"
git reset -q; rm -f p2.txt
shuttle -y commit -m "no change in that path" -- nothing.txt
assert_status 1 "$RC" "a path without changes"
assert_contains "$OUT" "nothing to commit in: nothing.txt" "...is refused"

# --- odd messages -------------------------------------------------------------------------------------------------------
echo q > q.txt; git add q.txt
shuttle -y commit -m "fix: \"quotes\", \$HOME, 'single' and ünïcode ✓"
assert_status 0 "$RC" "quotes, a dollar sign and unicode in the message"
assert_eq "fix: \"quotes\", \$HOME, 'single' and ünïcode ✓" "$(git log -1 --format=%s)" "...arrive unchanged"
echo q2 > q2.txt; git add q2.txt
shuttle -y commit -m "title

body line"
assert_eq "title" "$(git log -1 --format=%s)" "a multi-line message keeps its title"

# --- message rules --------------------------------------------------------------------------------------------------------
git config shuttle.messagePattern '^\[[A-Z]+\] [a-z_]+: .+'
echo r > r.txt; git add r.txt
shuttle -y commit -m "no tag here"
assert_status 1 "$RC" "a message that does not match shuttle.messagePattern"
assert_contains "$OUT" "does not match shuttle.messagePattern" "...says which rule"
shuttle -y commit -m "[FIX] sales: the right shape"
assert_status 0 "$RC" "a message that matches"
git config shuttle.messagePattern '['
echo r2 > r2.txt; git add r2.txt
shuttle -y commit -m "anything"
assert_status 1 "$RC" "an invalid pattern"
assert_contains "$OUT" "not a valid regular expression" "...is reported, not ignored"
git config --unset shuttle.messagePattern

git config shuttle.forbidTrailers "Co-Authored-By Signed-off-by"
shuttle -y commit -m "ok

co-authored-by: Someone <a@b.c>"
assert_status 1 "$RC" "a forbidden trailer, in any case"
assert_contains "$OUT" "'Co-Authored-By:' line" "...is named"
shuttle -y commit -m "fine without the trailer"
assert_status 0 "$RC" "the same message without the trailer"
git config shuttle.forbidTrailers "bad name!"
echo r3 > r3.txt; git add r3.txt
shuttle -y commit -m "x"
assert_status 1 "$RC" "a trailer setting that is not a name"
git config --unset shuttle.forbidTrailers

# --- dry run, and the prompt -------------------------------------------------------------------------------------------
echo d > d.txt; git add d.txt; before=$(heads)
shuttle -n commit -m "dry"
assert_status 0 "$RC" "--dry-run"
assert_contains "$OUT" "git commit -m dry" "...shows the command"
assert_eq "$before" "$(heads)" "...and commits nothing"
shuttle -n commit -m "[IMP] docs: it's a \"test\" with \$HOME; and (parens)"
assert_contains "$OUT" "git commit -m '[IMP] docs: it'\\''s a \"test\" with \$HOME; and (parens)'" "a dry run shows the command the way you would type it: single quotes, not backslashes"
assert_not_contains "$OUT" "\\ " "...no backslash-escaped spaces"
shuttle commit -m "no terminal"
assert_status 1 "$RC" "without --yes and without a terminal"
assert_contains "$OUT" "without a terminal" "...it does not guess"
with_tty n "$SHUTTLE" commit -m declined
assert_status 3 "$RC" "answering n at the prompt"
assert_contains "$OUT" "nothing was changed" "...says nothing was changed"
assert_eq "$before" "$(heads)" "...commits nothing"
with_tty "" "$SHUTTLE" commit -m accepted
assert_status 0 "$RC" "answering Enter at the prompt"
assert_eq "accepted" "$(git log -1 --format=%s)" "...commits"

# --- the same rules for commits made without shuttle: the hook --------------------------------------------------------------
PATH="$(dirname "$SHUTTLE"):$PATH"; export PATH   # the hook calls git-shuttle by name, as it does on a real machine
shuttle -y hook install
assert_status 0 "$RC" "hook install"
git config shuttle.messagePattern '^\[[A-Z]+\] .+'
echo h > h.txt; git add h.txt
out=$(git commit -m "plain git, wrong shape" 2>&1); rc=$?
assert_eq "1" "$rc" "git commit with a message that breaks the rule is refused by the hook"
assert_contains "$out" "does not match shuttle.messagePattern" "...with the reason"
git commit -q -m "[FIX] plain git, right shape"; assert_eq "0" "$?" "...and a good one passes"
git commit -q --allow-empty -m "fixup! something" ; assert_eq "0" "$?" "fixup! is never checked"
shuttle -y hook install
assert_status 0 "$RC" "installing twice is fine"
shuttle hook status
assert_contains "$OUT" "installed" "hook status"
# on a machine without git-shuttle the hook must not block anyone
bare_path=$(command -v git | xargs dirname)
echo hh > hh.txt; git add hh.txt
out=$(PATH="$bare_path:/usr/bin:/bin" git commit -m "no tag, and git-shuttle is not installed here" 2>&1); rc=$?
assert_eq "0" "$rc" "the hook lets a commit through when git-shuttle is not installed"
shuttle -y hook uninstall
assert_status 0 "$RC" "hook uninstall"
echo h2 > h2.txt; git add h2.txt
git commit -q -m "wrong again, no hook now"; assert_eq "0" "$?" "...and the rule no longer applies"
printf '#!/bin/sh\nexit 0\n' > .git/hooks/commit-msg; chmod +x .git/hooks/commit-msg
shuttle -y hook install
assert_status 1 "$RC" "a hook that is not ours"
assert_contains "$OUT" "is not git-shuttle's" "...is not overwritten"
shuttle -y hook uninstall
assert_status 1 "$RC" "...and not removed"

finish
