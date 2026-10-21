#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

sandbox_new

# two features, shipped to develop with merge commits, one commit more than the other
feature feat/one one.txt
echo more > one-more.txt; git add one-more.txt; git commit -q -m "one, second commit"
shuttle -y merge
git checkout -q -b feat/two develop; echo t > two.txt; git add two.txt; git commit -q -m "work on two"
shuttle -y merge
git checkout -q main

# --- a merged branch stands for its commits -------------------------------------------------------------------------------------
shuttle -y release --onto rel/1 feat/one
assert_status 0 "$RC" "release from a merged branch"
assert_eq "rel/1" "$(git branch --show-current)" "...you are on the new branch"
assert_eq "one, second commit work on feat/one" "$(git log --format=%s -2 | paste -sd' ')" "...it has exactly the commits of the branch, in order"
assert_eq "2" "$(git rev-list --count origin/release..rel/1)" "...and nothing else from develop"
git checkout -q main
shuttle -y release --onto rel/2 feat/one feat/two
assert_eq "3" "$(git rev-list --count origin/release..rel/2)" "two branches: all their commits"
assert_eq "work on two" "$(git log --format=%s -1)" "...in the order of the arguments"
git checkout -q main
shuttle -y release --onto rel/3 feat/two feat/one
assert_eq "one, second commit" "$(git log --format=%s -1)" "the other order is kept"
git checkout -q main

# --- a branch and a commit together, duplicates once -------------------------------------------------------------------------------
C=$(git rev-parse feat/two)
shuttle -y release --onto rel/4 feat/two "$C"
assert_status 0 "$RC" "a branch and one of its own commits"
assert_eq "1" "$(git rev-list --count origin/release..rel/4)" "...the commit is picked once"
git checkout -q main

# --- a branch that was not merged yet -----------------------------------------------------------------------------------------------
git checkout -q -b feat/three develop; echo th > three.txt; git add three.txt; git commit -q -m "work on three"; git push -q -u origin feat/three
git checkout -q main
shuttle -y release --onto rel/5 feat/three
assert_status 0 "$RC" "release from a branch that is not in the integration branch yet"
assert_eq "work on three" "$(git log --format=%s -1)" "...its own commits"
assert_eq "1" "$(git rev-list --count origin/release..rel/5)" "...and only those"
git checkout -q main
git branch -q -D feat/three
shuttle -y release --onto rel/6 feat/three
assert_status 0 "$RC" "the same from the remote branch when the local one is gone"
git checkout -q main

# --- a fast-forward merge leaves no trace of the branch ------------------------------------------------------------------------------
git checkout -q -b feat/ff develop; echo ff > ff.txt; git add ff.txt; git commit -q -m "work on ff"; git push -q origin feat/ff
git checkout -q develop; git merge -q --ff-only feat/ff; git push -q origin develop; git checkout -q main
shuttle -y release --onto rel/7 feat/ff
assert_status 1 "$RC" "a branch merged by fast-forward"
assert_contains "$OUT" "cannot tell which commits 'feat/ff' brought" "...is refused, and says to give the commits"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/7 && echo yes || echo no)" "...and no branch was created"
HASH=$(git rev-parse feat/ff)
shuttle -y release --onto rel/8 "$HASH"
assert_status 0 "$RC" "...with the commit given, it works"
git checkout -q main

# --- refusals --------------------------------------------------------------------------------------------------------------------------
shuttle -y release --onto rel/9 not-a-thing
assert_status 1 "$RC" "a name that is neither a branch nor a commit"
assert_contains "$OUT" "is not a commit" "...is named"
shuttle -y release --onto rel/9
assert_status 1 "$RC" "nothing to release"
shuttle -y release feat/one
assert_status 1 "$RC" "no --onto"
shuttle -y release --onto rel/1 feat/two
assert_status 1 "$RC" "a release branch that already exists"
shuttle -y release --bogus
assert_status 1 "$RC" "an unknown option"
before=$(git rev-parse HEAD)
shuttle -n release --onto rel/10 feat/one
assert_status 0 "$RC" "release --dry-run"
assert_contains "$OUT" "git cherry-pick" "...shows the commands"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/10 && echo yes || echo no)" "...and creates nothing"
assert_eq "$before" "$(git rev-parse HEAD)" "...nor moves you"
shuttle -y release --onto rel/11 --push feat/two
assert_status 0 "$RC" "release --push"
assert_eq "work on two" "$(remote_log rel/11 | head -1)" "...the branch is on the remote"

finish
