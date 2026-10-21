#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

sandbox_new

# --- the whole way ---------------------------------------------------------------------------------------------------
feature feat/m
shuttle -y merge
assert_status 0 "$RC" "merge of a feature branch"
assert_eq "feat/m" "$(git branch --show-current)" "...ends on the feature branch again"
assert_eq "Merge branch 'feat/m' into develop" "$(remote_log develop | head -1)" "...the integration branch got a merge commit"
assert_contains "$(remote_log develop | head -3)" "work on feat/m" "...with the feature commit under it"
assert_eq "2" "$(git -C "$REMOTE" rev-list --parents -n 1 develop | wc -w | awk '{print $1 - 1}')" "...which has two parents (--no-ff)"
assert_eq "work on feat/m" "$(remote_log feat/m | head -1)" "...and the feature branch itself is on the remote"
assert_eq "$(git -C "$REMOTE" rev-parse develop)" "$(git rev-parse develop)" "...the local integration branch matches the remote"
assert_eq "origin/feat/m" "$(git rev-parse --abbrev-ref "feat/m@{upstream}")" "...the feature branch tracks its remote branch"

shuttle -y merge
assert_status 0 "$RC" "merge again, with nothing new"
assert_contains "$OUT" "nothing to merge" "...says so, and changes nothing"

# --- the integration branch moved: the feature is rebased first ---------------------------------------------------------
feature feat/m2
remote_commit develop later.txt "later" "work that landed meanwhile"
shuttle -y merge
assert_status 0 "$RC" "merge when the integration branch moved"
assert_eq "work that landed meanwhile" "$(remote_log feat/m2 | sed -n 2p)" "...the feature was rebased on it"
assert_eq "Merge branch 'feat/m2' into develop" "$(remote_log develop | head -1)" "...then merged"

# --- a feature that was already pushed and gets rewritten by the rebase ------------------------------------------------
feature feat/m3
git push -q -u origin feat/m3
remote_commit develop later2.txt "later2" "more work that landed"
shuttle -y merge
assert_status 2 "$RC" "merge that needs to rewrite a pushed branch"
assert_contains "$OUT" "--force-with-lease" "...stops, naming the way"
assert_eq "feat/m3" "$(git branch --show-current)" "...still on the feature branch"
assert_not_contains "$(remote_log develop | head -1)" "feat/m3" "...nothing reached the integration branch"
shuttle -y merge --force-with-lease
assert_status 0 "$RC" "...and with --force-with-lease it goes through"
assert_eq "Merge branch 'feat/m3' into develop" "$(remote_log develop | head -1)" "...merged"

# --- other integration branch, ff-only -----------------------------------------------------------------------------------
feature feat/m4
git checkout -q -b feat/m5 release; echo r > r5.txt; git add r5.txt; git commit -q -m "work on release"
shuttle -y merge --into release
assert_status 0 "$RC" "merge --into another branch"
assert_eq "Merge branch 'feat/m5' into release" "$(remote_log release | head -1)" "...goes there"
git checkout -q feat/m4
git config shuttle.mergeStrategy ff-only
shuttle -y merge
assert_status 0 "$RC" "merge with shuttle.mergeStrategy ff-only"
assert_eq "1" "$(git -C "$REMOTE" rev-list --parents -n 1 develop | wc -w | awk '{print $1 - 1}')" "...makes no merge commit"
assert_eq "work on feat/m4" "$(remote_log develop | head -1)" "...the feature commit is the tip"
git config shuttle.mergeStrategy sideways
feature feat/m6
shuttle -y merge
assert_status 1 "$RC" "an unknown merge strategy"
assert_contains "$OUT" "must be 'noff' or 'ff-only'" "...is refused"
git config --unset shuttle.mergeStrategy

# --- refusals change nothing -----------------------------------------------------------------------------------------------
echo dirty >> feat/m6.txt
shuttle -y merge
assert_status 1 "$RC" "merge with uncommitted changes"
git checkout -q -- feat/m6.txt
git checkout -q develop
shuttle -y merge
assert_status 1 "$RC" "merge of a protected branch"
git checkout -q feat/m6
shuttle -y merge --into no-such-branch
assert_status 1 "$RC" "merge into a branch the remote does not have"
assert_contains "$OUT" "does not exist on 'origin'" "...says so"
before=$(git -C "$REMOTE" rev-parse develop)
shuttle -n merge
assert_status 0 "$RC" "merge --dry-run"
assert_contains "$OUT" "git merge --no-ff" "...shows the commands"
assert_eq "$before" "$(git -C "$REMOTE" rev-parse develop)" "...and changes nothing on the remote"
assert_eq "feat/m6" "$(git branch --show-current)" "...nor the branch you are on"
shuttle merge
assert_status 1 "$RC" "merge without --yes and without a terminal"
with_tty n "$SHUTTLE" merge
assert_status 3 "$RC" "merge, answering n"
assert_eq "$before" "$(git -C "$REMOTE" rev-parse develop)" "...changes nothing"

# --- a conflict in the merge itself (--no-sync skips the rebase that would meet it first) -------------------------------------
git checkout -q -b feat/c1 develop; echo "feature side" > clash.txt; git add clash.txt; git commit -q -m "feature adds clash"
remote_commit develop clash.txt "develop side" "develop adds clash"
shuttle -y merge --no-sync
assert_status 2 "$RC" "a conflict in the merge"
assert_eq "develop" "$(git branch --show-current)" "...you are on the integration branch"
assert_contains "$OUT" "git merge --abort" "...with the way out"
assert_eq "yes" "$([[ -f "$(git rev-parse --git-path MERGE_HEAD)" ]] && echo yes || echo no)" "...and the merge left for you to finish"
git merge --abort
git checkout -q feat/c1
shuttle -y merge
assert_status 2 "$RC" "the same conflict met while rebasing"
assert_contains "$OUT" "git rebase --continue" "...stops at the rebase"
git rebase --abort

# --- a local integration branch with commits of its own -----------------------------------------------------------------------
git checkout -q develop; git reset -q --hard origin/develop; echo own > own.txt; git add own.txt; git commit -q -m "a commit only here"
feature feat/m7
before=$(git -C "$REMOTE" rev-parse develop)
shuttle -y merge
assert_status 1 "$RC" "merge while the local integration branch has commits the remote lacks"
assert_contains "$OUT" "would push them too" "...is refused: they would ride along"
assert_eq "$before" "$(git -C "$REMOTE" rev-parse develop)" "...and nothing was pushed"
assert_eq "feat/m7" "$(git branch --show-current)" "...nor did it move you"

# --- ... and one that has diverged from the remote ----------------------------------------------------------------------------
git checkout -q develop; git reset -q --hard origin/develop
git checkout -q -b feat/m7b develop; echo b > b7.txt; git add b7.txt; git commit -q -m "work on feat/m7b"
git checkout -q develop; echo own2 > own2.txt; git add own2.txt; git commit -q -m "another commit only here"
git checkout -q feat/m7b
git update-ref refs/heads/stash-local develop      # keep the local-only commit reachable for the check below
git branch -q -f develop origin/develop            # the local branch is clean again, then the remote moves
remote_commit develop moved.txt "moved" "the remote moved"
git branch -q -f develop stash-local                # local develop = old base + own commit; remote develop = old base + moved
shuttle -y merge
assert_status 1 "$RC" "a local integration branch that is not the remote's"
git branch -q -D stash-local; git branch -q -f develop origin/develop
git fetch -q origin; git branch -q -f develop origin/develop
git checkout -q feat/m7b

# --- the remote refuses the push of the integration branch -----------------------------------------------------------------------
feature feat/m8
reject_pushes develop
shuttle -y merge
assert_status 2 "$RC" "the push of the integration branch is rejected"
assert_contains "$OUT" "was rejected" "...is reported"
assert_eq "develop" "$(git branch --show-current)" "...and you are left on it, with the merge done locally"

finish
