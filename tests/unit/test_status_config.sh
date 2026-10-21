#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

# --- outside a repository -------------------------------------------------------------------------------------
plain=$(mktemp -d); trap 'rm -rf "$plain"' EXIT
( cd "$plain" && "$SHUTTLE" status ) >"$plain/out" 2>&1; rc=$?
assert_status 1 "$rc" "status outside a repository"
assert_contains "$(cat "$plain/out")" "not inside a git repository" "...says why"
( cd "$plain" && "$SHUTTLE" --version ) >"$plain/out" 2>&1
assert_contains "$(cat "$plain/out")" "git-shuttle 0." "--version works anywhere"
( cd "$plain" && "$SHUTTLE" nonsense ) >"$plain/out" 2>&1; rc=$?
assert_status 1 "$rc" "an unknown command"
assert_contains "$(cat "$plain/out")" "unknown command" "...is named"

sandbox_new

# --- status -----------------------------------------------------------------------------------------------------
shuttle status
assert_status 0 "$RC" "status on the base branch"
assert_contains "$OUT" "repository: my work" "...names the repository (a path with a space)"
assert_contains "$OUT" "branch:     main" "...and the branch"
assert_contains "$OUT" "(protected)" "...a protected branch is marked"
assert_contains "$OUT" "0 staged, 0 unstaged, 0 untracked" "...a clean tree"

feature feat/one
echo x > untracked.txt; echo y >> file.txt; git add file.txt; echo z >> feat/one.txt
shuttle status
assert_contains "$OUT" "branch:     feat/one" "a branch with a slash"
assert_not_contains "$OUT" "(protected)" "...is not protected"
assert_contains "$OUT" "1 staged, 1 unstaged, 1 untracked" "...counts staged, unstaged and untracked files"
assert_contains "$OUT" "upstream:   none" "...an unpushed branch"
git reset -q; git checkout -q -- .; rm -f untracked.txt

git checkout -q --detach
shuttle status
assert_status 0 "$RC" "status on a detached HEAD"
assert_contains "$OUT" "detached HEAD" "...says so"
git checkout -q feat/one
git push -q -u origin feat/one 2>/dev/null
shuttle status
assert_contains "$OUT" "upstream:   origin/feat/one  (ahead 0, behind 0)" "a pushed branch shows its upstream"
assert_contains "$OUT" "vs origin/develop:  ahead 1, behind 0" "...and where it stands against the integration branch"

# --- config ---------------------------------------------------------------------------------------------------------
shuttle config
assert_status 0 "$RC" "config"
assert_eq "develop" "$(awk '$1 == "integration" { print $2 }' <<<"$OUT")" "shows a value that was set"
assert_contains "$OUT" "main (detected)" "...detects the base branch from the remote"
git config --unset shuttle.integration
shuttle config
assert_contains "$OUT" "main (default: base)" "the integration branch defaults to the base"
git config shuttle.base trunk
shuttle config
assert_contains "$OUT" "trunk" "a configured base wins over the detection"

finish
