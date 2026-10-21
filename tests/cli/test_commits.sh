#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/c; first=$(git rev-parse HEAD)
echo two > two.txt; git add two.txt; git commit -q -m "[ADD] two"; second=$(git rev-parse HEAD)

# --- revert --------------------------------------------------------------------------------------------------------------------------
shuttle -y revert "$second"
assert_status 0 "$RC" "revert a commit"
assert_eq "" "$(ls two.txt 2>/dev/null)" "...its file is gone"
assert_contains "$(git log -1 --format=%s)" "Revert" "...as a new commit"
shuttle -y revert nope
assert_status 1 "$RC" "revert something that is not a commit"
echo dirty >> file.txt
shuttle -y revert "$first"
assert_status 1 "$RC" "revert with a dirty tree"
git checkout -q -- file.txt
git checkout -q develop
shuttle -y revert "$first"
assert_status 1 "$RC" "revert on a protected branch"
git checkout -q feat/c

# --- amend ---------------------------------------------------------------------------------------------------------------------------
before=$(git rev-parse "HEAD^{tree}")
shuttle -y amend -m "[FIX] reworded"
assert_status 0 "$RC" "amend the message of an unpushed commit"
assert_eq "[FIX] reworded" "$(git log -1 --format=%s)" "...the message changed"
assert_eq "$before" "$(git rev-parse "HEAD^{tree}")" "...the content did not"
shuttle -y amend
assert_status 1 "$RC" "amend without a message"
git push -q -u origin feat/c
shuttle -y amend -m "[FIX] after push"
assert_status 1 "$RC" "amend a pushed commit"
assert_eq "[FIX] reworded" "$(git log -1 --format=%s)" "...changes nothing"
shuttle -y amend -m "[FIX] after push" --allow-pushed
assert_status 0 "$RC" "amend a pushed commit when told to"

# --- tag / untag ---------------------------------------------------------------------------------------------------------------------
shuttle -y tag v1 "$first"
assert_status 0 "$RC" "a lightweight tag"
assert_eq "$first" "$(git rev-parse "v1^{commit}")" "...on that commit"
assert_eq "commit" "$(git cat-file -t v1)" "...lightweight"
shuttle -y tag v2 -m "release two"
assert_eq "tag" "$(git cat-file -t v2)" "an annotated tag with a message"
shuttle -y tag v1
assert_status 1 "$RC" "a tag that exists"
for bad in "tag -x" "tag a..b" "tag bad~name" "tag"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: $bad"
done
shuttle -y tag v3 --push
assert_ne "" "$(git -C "$REMOTE" tag --list v3)" "--push puts it on the remote"
shuttle -y untag v3 --remote
assert_status 0 "$RC" "untag here and on the remote"
assert_eq "" "$(git tag --list v3)$(git -C "$REMOTE" tag --list v3)" "...gone in both"
shuttle -y untag nothing
assert_status 1 "$RC" "untag an unknown tag"

# --- reset ---------------------------------------------------------------------------------------------------------------------------
git checkout -q -b local-r develop
echo a > a.txt; git add a.txt; git commit -q -m "[ADD] a"
echo b > b.txt; git add b.txt; git commit -q -m "[ADD] b"
base=$(git rev-parse HEAD~2)
shuttle -y reset --soft HEAD~1
assert_status 0 "$RC" "reset --soft"
assert_eq "A  b.txt" "$(git status --porcelain)" "...the change stays staged"
git commit -q -m "[ADD] b"
shuttle -y reset --mixed HEAD~1
assert_eq "?? b.txt" "$(git status --porcelain)" "reset --mixed leaves it unstaged"
rm b.txt; git add -A; git commit -q -m "[ADD] c" --allow-empty
shuttle -y reset --hard "$base"
assert_status 1 "$RC" "--hard without the branch name"
shuttle -y reset --hard "$base" --confirm-branch other
assert_status 1 "$RC" "--hard with the wrong name"
shuttle -y reset --hard "$base" --confirm-branch local-r
assert_status 0 "$RC" "--hard with the branch name"
assert_eq "$base" "$(git rev-parse HEAD)" "...the branch is at the commit"
shuttle -y reset --hard "$base" --confirm-branch local-r
assert_status 1 "$RC" "already there"
echo z > z.txt; git add z.txt; git commit -q -m "[ADD] z"; zed=$(git rev-parse HEAD)
shuttle -y reset --mixed HEAD~1
assert_status 0 "$RC" "reset --mixed again, to have something to undo"
shuttle -y undo
assert_status 1 "$RC" "undo a reset while its files are untracked in the way"
assert_contains "$OUT" "untracked files in the way" "...says why"
rm z.txt
shuttle -y undo
assert_status 0 "$RC" "undo a reset"
assert_eq "$zed" "$(git rev-parse HEAD)" "...the branch is back"
git checkout -q feat/c; git push -q --force-with-lease origin feat/c
shuttle -y reset --soft HEAD~1
assert_status 1 "$RC" "reset past pushed commits"
shuttle -y reset --soft --hard HEAD~1
assert_status 1 "$RC" "two modes"
git checkout -q develop
shuttle -y reset --soft HEAD~1
assert_status 1 "$RC" "reset on a protected branch"

# --- link ----------------------------------------------------------------------------------------------------------------------------
git remote add hub "https://user:s3cret@github.com/acme/widgets.git"
git config shuttle.remote hub
shuttle link "$first"
assert_contains "$OUT" "https://github.com/acme/widgets/commit/$first" "a GitHub link"
assert_not_contains "$OUT" "s3cret" "...without credentials"
git remote set-url hub "git@gitlab.example.org:group/proj.git"
shuttle link "$first"
assert_contains "$OUT" "https://gitlab.example.org/group/proj/-/commit/$first" "a GitLab link from an ssh address"
git remote set-url hub "https://example.org/a/b.git"
shuttle link "$first"
assert_status 1 "$RC" "an unknown hosting service"
shuttle link nope
assert_status 1 "$RC" "not a commit"

finish
