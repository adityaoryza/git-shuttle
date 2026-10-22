#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

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

# --- --empty: the release branch with no commit yet --------------------------------------------------------------------------------
git checkout -q main
shuttle -y release --onto rel/e1 --empty
assert_status 0 "$RC" "release --empty"
assert_eq "rel/e1" "$(git branch --show-current)" "...you are on the new branch"
assert_eq "$(git rev-parse origin/release)" "$(git rev-parse HEAD)" "...it is the remote release branch, with no commit of its own"
assert_eq "0" "$(git rev-list --count origin/release..rel/e1)" "...nothing from the integration branch"
assert_eq "" "$(git rev-parse --abbrev-ref 'rel/e1@{upstream}' 2>/dev/null)" "...without an upstream, as a release branch made by pick"
git checkout -q main
shuttle -y release --onto rel/e1 --empty
assert_status 1 "$RC" "release --empty on a name that exists"
assert_contains "$OUT" "already exists" "...is refused"
shuttle -y release --onto rel/e2 --empty feat/one
assert_status 1 "$RC" "release --empty with commits"
assert_contains "$OUT" "no commit" "...is refused: it makes a branch with none"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/e2 && echo yes || echo no)" "...and no branch was made"
shuttle -y release --empty
assert_status 1 "$RC" "release --empty without a name"
shuttle -y release --onto rel/e3 --empty --append
assert_status 1 "$RC" "--empty with --append"
before=$(git rev-parse HEAD)
shuttle -n release --onto rel/e4 --empty --push
assert_status 0 "$RC" "release --empty --dry-run"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/e4 && echo yes || echo no)" "...creates nothing"
assert_eq "$before" "$(git rev-parse HEAD)" "...and does not move you"
shuttle -y release --onto rel/e5 --empty --push
assert_status 0 "$RC" "release --empty --push"
assert_eq "$(git rev-parse origin/release)" "$(git -C "$REMOTE" rev-parse rel/e5)" "...the branch is on the remote, at the release branch"
git checkout -q main
echo dirty >> file.txt
shuttle -y release --onto rel/e6 --empty
assert_status 1 "$RC" "release --empty with uncommitted changes"
git checkout -q -- file.txt

# --- --append: more commits on a release branch that exists ------------------------------------------------------------------------
git checkout -q main
shuttle -y release --onto rel/e1 --append feat/one
assert_status 0 "$RC" "release --append a branch"
assert_eq "rel/e1" "$(git branch --show-current)" "...you are on the release branch"
assert_eq "2" "$(git rev-list --count origin/release..rel/e1)" "...with the commits of the branch, picked in order"
git checkout -q main
shuttle -y release --onto rel/e1 --append feat/one feat/two
assert_status 0 "$RC" "release --append again, with one that is already there"
assert_eq "3" "$(git rev-list --count origin/release..rel/e1)" "...only the new one is added"
assert_eq "work on two" "$(git log --format=%s -1)" "...on top"
git checkout -q main
shuttle -y release --onto rel/nowhere --append feat/one
assert_status 1 "$RC" "release --append to a branch that does not exist"
assert_contains "$OUT" "--empty" "...says how to make it"
shuttle -y release --onto rel/e1 --append
assert_status 1 "$RC" "release --append without a commit"
shuttle -y release --append feat/one
assert_status 1 "$RC" "release --append without the release branch"
shuttle -y release --onto main --append feat/one
assert_status 1 "$RC" "release --append onto a protected branch"
assert_contains "$OUT" "protected" "...is refused"
git branch -q -D rel/e1; git fetch -q origin
git -C "$REMOTE" branch -q rel/remote-only origin/release 2>/dev/null || git -C "$REMOTE" branch -q rel/remote-only release
git fetch -q origin
shuttle -y release --onto rel/remote-only --append feat/one
assert_status 0 "$RC" "release --append to a release branch that only the remote has"
assert_eq "rel/remote-only" "$(git branch --show-current)" "...a local copy is made and used"
assert_eq "2" "$(git rev-list --count origin/release..rel/remote-only)" "...with the commits of the branch"
git checkout -q main
shuttle -y release --onto rel/remote-only --append --push feat/two
assert_status 0 "$RC" "release --append --push"
assert_eq "$(git rev-parse rel/remote-only)" "$(git -C "$REMOTE" rev-parse rel/remote-only)" "...the commits are on the remote branch too"
git checkout -q main
before=$(git rev-parse rel/remote-only)
shuttle -n release --onto rel/remote-only --append feat/two
assert_status 0 "$RC" "release --append --dry-run"
assert_eq "$before" "$(git rev-parse rel/remote-only)" "...changes nothing"
assert_eq "main" "$(git branch --show-current)" "...and does not move you"

finish
