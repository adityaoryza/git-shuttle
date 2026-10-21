#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

sandbox_new

# three commits on develop, each its own file, to pick from
git checkout -q develop
for n in A B C; do echo "$n" > "$n.txt"; git add "$n.txt"; git commit -q -m "commit $n"; done
git push -q origin develop
A=$(git rev-parse HEAD~2); B=$(git rev-parse HEAD~1); C=$(git rev-parse HEAD)
git checkout -q main

# --- the plain case --------------------------------------------------------------------------------------------------
shuttle -y pick --onto rel/1 "$A" "$B" "$C"
assert_status 0 "$RC" "pick three commits onto a new release branch"
assert_eq "rel/1" "$(git branch --show-current)" "...you are on the new branch"
assert_eq "commit C commit B commit A" "$(git log --format=%s -3 | paste -sd' ')" "...in the order given"
assert_eq "3" "$(git rev-list --count origin/release..rel/1)" "...three commits on top of the remote release branch"
assert_eq "" "$(git rev-parse --abbrev-ref "rel/1@{upstream}" 2>/dev/null)" "...with no upstream, nothing was pushed"
assert_eq "" "$(git -C "$REMOTE" branch --list rel/1)" "...and the remote has no such branch"

git checkout -q main
shuttle -y pick --onto rel/2 "$C" "$A"
assert_eq "commit A commit C" "$(git log --format=%s -2 | paste -sd' ')" "a different order is kept"
git checkout -q main
shuttle -y pick --onto rel/3 --push "$A"
assert_status 0 "$RC" "pick --push"
assert_eq "commit A" "$(remote_log rel/3 | head -1)" "...the branch is on the remote"
assert_eq "origin/rel/3" "$(git rev-parse --abbrev-ref "rel/3@{upstream}")" "...with its upstream"

# --- the shapes it refuses ----------------------------------------------------------------------------------------------
git checkout -q main
shuttle -y pick --onto rel/1 "$A"
assert_status 1 "$RC" "a branch that already exists"
assert_contains "$OUT" "already exists" "...is refused"
git branch -q -D rel/2
git push -q origin rel/3:rel/remote-only 2>/dev/null
shuttle -y pick --onto rel/remote-only "$A"
assert_status 1 "$RC" "a branch that exists on the remote"
assert_contains "$OUT" "already exists on 'origin'" "...is refused"
shuttle -y pick --onto "bad name" "$A"
assert_status 1 "$RC" "an invalid branch name"
shuttle -y pick --onto rel/4 deadbeefdeadbeef
assert_status 1 "$RC" "a commit that does not exist"
assert_contains "$OUT" "is not a commit" "...is named"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/4 && echo yes || echo no)" "...and no branch was created"
shuttle -y pick --onto rel/4
assert_status 1 "$RC" "no commit given"
shuttle -y pick "$A"
assert_status 1 "$RC" "no --onto"
shuttle -y pick --onto rel/4 --from nowhere "$A"
assert_status 1 "$RC" "--from a branch the remote does not have"
shuttle -y pick --onto rel/4 --strategy-option wild "$A"
assert_status 1 "$RC" "an unknown strategy option"
git checkout -q develop; git merge -q --no-ff -m "a merge" main 2>/dev/null || true
git checkout -q -b side main; echo s > s.txt; git add s.txt; git commit -q -m "side"; git checkout -q develop; git merge -q --no-ff -m "merge side" side; MERGE=$(git rev-parse HEAD)
git checkout -q main
shuttle -y pick --onto rel/5 "$MERGE"
assert_status 1 "$RC" "a merge commit"
assert_contains "$OUT" "is a merge commit" "...is refused"
echo dirty >> file.txt
shuttle -y pick --onto rel/6 "$A"
assert_status 1 "$RC" "pick with uncommitted changes"
git checkout -q -- file.txt
before=$(git rev-parse HEAD)
shuttle -n pick --onto rel/7 "$A" "$B"
assert_status 0 "$RC" "pick --dry-run"
assert_contains "$OUT" "git cherry-pick" "...shows the commands"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/7 && echo yes || echo no)" "...and creates nothing"
assert_eq "$before" "$(git rev-parse HEAD)" "...nor moves you"

# --- a commit the release branch already has -----------------------------------------------------------------------------------
git checkout -q release; echo A > A.txt; git add A.txt; git commit -q -m "A made by hand on release"; git push -q origin release
git checkout -q main
shuttle -y pick --onto rel/8 "$A" "$B"
assert_status 0 "$RC" "a commit whose change the release branch already has"
assert_contains "$OUT" "already in origin/release: skipped" "...is skipped"
assert_eq "commit B" "$(git log -1 --format=%s)" "...and the others are still picked"
assert_eq "1" "$(git rev-list --count origin/release..rel/8)" "...so one commit lands"

# --- a conflict ---------------------------------------------------------------------------------------------------------------
git checkout -q develop; echo "develop version" > clash.txt; git add clash.txt; git commit -q -m "clash on develop"; CL=$(git rev-parse HEAD)
echo D > D.txt; git add D.txt; git commit -q -m "commit D"; D=$(git rev-parse HEAD)
git checkout -q release; echo "release version" > clash.txt; git add clash.txt; git commit -q -m "clash on release"; git push -q origin release
git checkout -q main
shuttle -y pick --onto rel/9 "$CL" "$D"
assert_status 2 "$RC" "a conflict while picking"
assert_contains "$OUT" "git cherry-pick --continue" "...says how to go on"
assert_contains "$OUT" "$D" "...and lists the commits still to pick"
assert_eq "rel/9" "$(git branch --show-current)" "...you are on the new branch"
git cherry-pick --abort
git checkout -q main; git branch -q -D rel/9
shuttle -y pick --onto rel/10 --strategy-option theirs "$CL" "$D"
assert_status 0 "$RC" "the same conflict with --strategy-option theirs"
assert_eq "develop version" "$(cat clash.txt)" "...takes the picked side"
assert_eq "commit D" "$(git log -1 --format=%s)" "...and goes on to the next commit"

finish
