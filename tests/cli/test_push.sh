#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/p

# --- publishing a branch: the first push sets the upstream -----------------------------------------------------------------------
shuttle -y push
assert_status 0 "$RC" "the first push of a branch"
assert_eq "origin/feat/p" "$(git rev-parse --abbrev-ref 'feat/p@{upstream}')" "...sets the upstream"
assert_eq "$(git rev-parse feat/p)" "$(git -C "$REMOTE" rev-parse feat/p)" "...and the remote has the branch"

# --- pushing what is ahead ---------------------------------------------------------------------------------------------------------
echo more >> feat/p.txt; git commit -q -am "more work"
shuttle -y push
assert_status 0 "$RC" "a push of new commits"
assert_eq "$(git rev-parse feat/p)" "$(git -C "$REMOTE" rev-parse feat/p)" "...reaches the remote"

# --- diverged: a plain push is rejected, a forced one has to be asked for ---------------------------------------------------------
git reset -q --hard HEAD~1
echo different >> feat/p.txt; git commit -q -am "rewritten work"
shuttle -y push
assert_status 2 "$RC" "a push of a branch that diverged from its upstream"
assert_contains "$OUT" "--force-with-lease" "...says what to use, and does not do it"
assert_ne "$(git rev-parse feat/p)" "$(git -C "$REMOTE" rev-parse feat/p)" "...the remote is untouched"
shuttle -y push --force-with-lease
assert_status 0 "$RC" "the same push, forced with a lease"
assert_eq "$(git rev-parse feat/p)" "$(git -C "$REMOTE" rev-parse feat/p)" "...replaces the remote branch"
remote_commit feat/p other.txt x "somebody else"
echo mine >> feat/p.txt; git commit -q -am "mine"
shuttle -y push --force-with-lease
assert_status 2 "$RC" "a forced push does not overwrite a commit it has not seen"

# --- refusals ------------------------------------------------------------------------------------------------------------------------
git checkout -q develop
shuttle -y push
assert_status 1 "$RC" "a protected branch"
assert_contains "$OUT" "protected" "...says why"
git checkout -q --detach
shuttle -y push
assert_status 1 "$RC" "a detached HEAD"
git checkout -q feat/p

# --- a dry run of "create a branch, then push it" --------------------------------------------------------------------------------------
GIT_SHUTTLE_ASSUME_BRANCH=new/published shuttle -n push
assert_status 0 "$RC" "a dry-run push of a branch that is assumed to exist"
assert_contains "$OUT" "git push -u origin new/published" "...pushes that branch and sets its upstream"
GIT_SHUTTLE_ASSUME_BRANCH=develop shuttle -n push
assert_status 1 "$RC" "...and still refuses a protected branch"
GIT_SHUTTLE_ASSUME_BRANCH=new/published shuttle -n push --force-with-lease
assert_contains "$OUT" "--force-with-lease" "...and keeps the flag"
GIT_SHUTTLE_ASSUME_BRANCH=new/published shuttle -y push
assert_not_contains "$OUT" "new/published" "the assumption is only for a dry run: a real push uses the branch you are on"

finish
