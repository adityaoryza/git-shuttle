#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/one; git push -q -u origin feat/one
git checkout -q develop

# --- rename ---------------------------------------------------------------------------------------------------------------------------
shuttle -y rename feat/one feat/uno
assert_status 0 "$RC" "rename a local branch"
assert_eq "feat/uno" "$(git branch --list feat/uno | tr -d ' *')" "...the new name exists"
assert_eq "" "$(git branch --list feat/one)" "...the old one is gone"
assert_eq "origin/feat/one" "$(git rev-parse --abbrev-ref "feat/uno@{upstream}")" "...the upstream stays what it was"
assert_ne "" "$(git -C "$REMOTE" branch --list feat/one)" "...the remote is untouched"
shuttle -y rename feat/uno feat/dos --remote
assert_status 0 "$RC" "rename it on the remote too"
assert_ne "" "$(git -C "$REMOTE" branch --list feat/dos)" "...the new name is on the remote"
assert_eq "" "$(git -C "$REMOTE" branch --list feat/one)" "...the old name is not"
assert_eq "origin/feat/dos" "$(git rev-parse --abbrev-ref "feat/dos@{upstream}")" "...and the upstream follows"
for bad in "rename develop other" "rename feat/dos develop" "rename feat/dos feat/dos" "rename feat/dos -x" "rename feat/dos a..b" "rename nope other" "rename feat/dos" "rename"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: $bad"
done
git branch other-work develop; git worktree add -q "$SB/wt" other-work 2>/dev/null
shuttle -y rename other-work renamed
assert_status 1 "$RC" "a branch another worktree has checked out"
assert_contains "$OUT" "another worktree" "...says so"
git worktree remove --force "$SB/wt"
git branch local-only develop
shuttle -y rename local-only x --remote
assert_status 1 "$RC" "--remote for a branch with no upstream"
shuttle -n rename feat/dos feat/tres --remote
assert_contains "$OUT" "git push origin --delete feat/dos" "a dry run shows the remote steps"
assert_eq "feat/dos" "$(git branch --list feat/dos | tr -d ' *')" "...and changes nothing"

# --- delete --------------------------------------------------------------------------------------------------------------------------
git checkout -q -b scratch develop; echo s > s.txt; git add s.txt; git commit -q -m "scratch work"; git checkout -q develop
shuttle -y delete scratch
assert_status 1 "$RC" "delete a branch with commits that are nowhere else"
assert_contains "$OUT" "--force" "...says what to do"
assert_ne "" "$(git branch --list scratch)" "...and keeps it"
shuttle -n delete scratch --force
assert_contains "$OUT" "1 commit(s) are on no other branch" "a dry-run --force says what would be lost"
shuttle -y delete scratch --force
assert_status 0 "$RC" "delete it with --force"
assert_eq "" "$(git branch --list scratch)" "...gone"
git checkout -q -b merged-already develop; git checkout -q develop
shuttle -y delete merged-already
assert_status 0 "$RC" "delete a merged branch without --force"
shuttle -y delete develop
assert_status 1 "$RC" "a protected branch"
git checkout -q feat/dos
shuttle -y delete feat/dos
assert_status 1 "$RC" "the branch you are on"
git checkout -q develop
shuttle -y delete --remote feat/dos
assert_status 0 "$RC" "delete a branch on the remote"
assert_eq "" "$(git -C "$REMOTE" branch --list feat/dos)" "...it is gone there"
shuttle -y delete --remote develop
assert_status 1 "$RC" "never a protected branch on the remote"
shuttle -y delete --remote never-existed
assert_status 1 "$RC" "a remote branch that does not exist"
shuttle -y delete -x
assert_status 1 "$RC" "an option that does not exist"

# --- upstream ----------------------------------------------------------------------------------------------------------------------------
git checkout -q -b up develop
shuttle -y upstream
assert_contains "$OUT" "(no upstream)" "no upstream is said so"
shuttle -y upstream --set origin/develop
assert_status 0 "$RC" "set an upstream"
assert_eq "origin/develop" "$(git rev-parse --abbrev-ref "up@{upstream}")" "...it is set"
shuttle -y upstream --set origin/nowhere
assert_status 1 "$RC" "an upstream that does not exist"
shuttle -y upstream --unset
assert_status 0 "$RC" "remove the upstream"
assert_eq "" "$(git rev-parse --abbrev-ref "up@{upstream}" 2>/dev/null)" "...it is gone"
shuttle -y upstream --unset
assert_status 1 "$RC" "removing what is not there"
git checkout -q develop; git branch -q -D up

# --- merge-in -----------------------------------------------------------------------------------------------------------------------------
git checkout -q -b target develop; git checkout -q -b source develop; echo src > src.txt; git add src.txt; git commit -q -m "source work"
git checkout -q target
shuttle -y merge-in source
assert_status 0 "$RC" "merge a branch into the current one (fast-forward when it can)"
assert_eq "$(git rev-parse source)" "$(git rev-parse HEAD)" "...which is a fast-forward"
shuttle -y merge-in source
assert_contains "$OUT" "nothing to merge" "merging it again says so"
git checkout -q -b target2 develop; echo t2 > t2.txt; git add t2.txt; git commit -q -m "target2 work"
shuttle -y merge-in source --ff-only
assert_status 1 "$RC" "--ff-only on diverged branches"
shuttle -y merge-in source --no-ff
assert_status 0 "$RC" "--no-ff makes a merge commit"
assert_contains "$(git log -1 --format=%s)" "Merge branch 'source'" "...named as git names it"
git checkout -q -b target3 develop; echo clash > src.txt; git add src.txt; git commit -q -m "clash"
shuttle -y merge-in source
assert_status 2 "$RC" "a conflict stops, with a way on"
assert_contains "$OUT" "git shuttle continue" "...says how"
shuttle -y abort >/dev/null
git checkout -q develop
shuttle -y merge-in source
assert_status 1 "$RC" "merge-in on a protected branch"
git checkout -q target2; echo dirty >> t2.txt
shuttle -y merge-in source
assert_status 1 "$RC" "merge-in with uncommitted changes"
git checkout -q -- t2.txt

# --- rebase-on ------------------------------------------------------------------------------------------------------------------------------
git checkout -q -b rb develop; echo rb > rb.txt; git add rb.txt; git commit -q -m "rb work"
git checkout -q develop; echo news > news.txt; git add news.txt; git commit -q -m "develop news"; git checkout -q rb
shuttle -n rebase-on develop
assert_contains "$OUT" "replays:    1 commit(s) (1 new under them)" "a dry run says how many commits are replayed"
shuttle -y rebase-on develop
assert_status 0 "$RC" "rebase-on"
assert_eq "develop news" "$(git log -1 --format=%s HEAD~1)" "...the branch sits on top of develop"
shuttle -y rebase-on develop
assert_contains "$OUT" "nothing to rebase" "again: nothing to do"
git checkout -q develop
shuttle -y rebase-on main
assert_status 1 "$RC" "rebase-on a protected branch"
git checkout -q -b rb2 main; echo c1 > c.txt; git add c.txt; git commit -q -m c1
git checkout -q -b rb3 main; echo c2 > c.txt; git add c.txt; git commit -q -m c2
shuttle -y rebase-on rb2
assert_status 2 "$RC" "a conflict while rebasing"
shuttle -y abort >/dev/null

# --- compare ------------------------------------------------------------------------------------------------------------------------------
git checkout -q rb
shuttle compare develop
assert_contains "$OUT" "HEAD is 1 commit(s) ahead of develop and 0 behind" "compare in words"
shuttle compare rb develop
assert_contains "$OUT" "develop is 0 commit(s) ahead of rb and 1 behind" "compare two names"
shuttle compare develop --porcelain
text=$(printf '%s' "$OUT" | tr '\0' '\n')
assert_contains "$text" "ahead=1" "porcelain: ahead"
assert_contains "$text" "ahead-commit=" "...the commits"
assert_contains "$text" "file=A"$'\x1f'"rb.txt" "...and the files with their status"
shuttle compare nothing-like-this
assert_status 1 "$RC" "a name that is not a commit"

finish
