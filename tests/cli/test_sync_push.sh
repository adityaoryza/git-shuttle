#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/s

# --- sync -----------------------------------------------------------------------------------------------------------
shuttle -y sync
assert_status 0 "$RC" "sync when the integration branch has nothing new"
assert_contains "$OUT" "already contains origin/develop" "...says there is nothing to rebase"

remote_commit develop other.txt "from someone else" "someone else's work"
shuttle -y sync
assert_status 0 "$RC" "sync when the integration branch moved"
assert_eq "someone else's work" "$(git log --format=%s -2 | tail -1)" "...the branch now sits on top of it"
assert_eq "work on feat/s" "$(git log -1 --format=%s)" "...and keeps its own commit"
assert_not_contains "$OUT" "pushed" "...no warning for a branch that was never pushed"

remote_commit develop file.txt "conflicting line" "a change of file.txt on develop"
echo "my line" > file.txt; git commit -q -am "my change of file.txt"
shuttle -y sync
assert_status 2 "$RC" "sync that hits a conflict"
assert_contains "$OUT" "git rebase --continue" "...says how to go on"
assert_contains "$OUT" "git rebase --abort" "...and how to give up"
assert_eq "yes" "$([[ -d "$(git rev-parse --git-path rebase-merge)" ]] && echo yes || echo no)" "...and leaves the rebase for you to finish"
git rebase --abort
assert_eq "my change of file.txt" "$(git log -1 --format=%s)" "after --abort the branch is as it was"
git reset -q --hard HEAD~1

# --- refusals ---------------------------------------------------------------------------------------------------------
echo dirty >> feat/s.txt
shuttle -y sync
assert_status 1 "$RC" "sync with uncommitted changes"
assert_contains "$OUT" "uncommitted changes" "...is refused"
git checkout -q -- feat/s.txt
shuttle -y sync --onto no-such-branch
assert_status 1 "$RC" "sync onto a branch the remote does not have"
assert_contains "$OUT" "does not exist on 'origin'" "...says so"
git checkout -q develop
shuttle -y sync
assert_status 1 "$RC" "sync on a protected branch"
git checkout -q --detach
shuttle -y sync
assert_status 1 "$RC" "sync on a detached HEAD"
git checkout -q feat/s
shuttle -n sync
assert_status 0 "$RC" "sync --dry-run"
assert_contains "$OUT" "git fetch" "...shows the commands"

# --- push --------------------------------------------------------------------------------------------------------------
shuttle -y push
assert_status 0 "$RC" "the first push of a branch"
assert_eq "origin/feat/s" "$(git rev-parse --abbrev-ref "feat/s@{upstream}")" "...sets the upstream"
assert_eq "work on feat/s" "$(remote_log feat/s | head -1)" "...and the commit is on the remote"
echo more > more.txt; git add more.txt; git commit -q -m "second"
shuttle -y push
assert_status 0 "$RC" "the next push"
assert_eq "second" "$(remote_log feat/s | head -1)" "...sends the new commit"

remote_commit develop another.txt "again" "develop moves again"
shuttle -y sync
assert_contains "$OUT" "is already pushed" "sync warns that rebasing a pushed branch rewrites it"
shuttle -y push
assert_status 2 "$RC" "pushing a rewritten branch"
assert_contains "$OUT" "--force-with-lease" "...is rejected, and the hint names the way"
assert_not_contains "$(remote_log feat/s | head -1)" "develop moves again" "...and nothing was forced"
shuttle -y push --force-with-lease
assert_status 0 "$RC" "push --force-with-lease, asked for explicitly"
assert_eq "second" "$(remote_log feat/s | head -1)" "...replaces the remote branch"

git checkout -q develop
shuttle -y push
assert_status 1 "$RC" "push of a protected branch"
assert_contains "$OUT" "protected branch" "...is refused"
git checkout -q feat/s
echo x > x.txt; git add x.txt; git commit -q -m third
before=$(remote_log feat/s | head -1)
shuttle -n push
assert_eq "$before" "$(remote_log feat/s | head -1)" "push --dry-run sends nothing"
git remote rename origin gone
shuttle -y push
assert_status 1 "$RC" "push without the configured remote"
assert_contains "$OUT" "no remote named 'origin'" "...says so"
git config shuttle.remote gone
shuttle -y push
assert_status 0 "$RC" "shuttle.remote names another remote"

finish
