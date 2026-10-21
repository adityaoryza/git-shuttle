#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

sandbox_new
fake_gh

# --- start ---------------------------------------------------------------------------------------------------------------
git config shuttle.branchPrefix "9.0-feature/"
shuttle -y start "Keep manual Order-Date, on confirmation!"
assert_status 0 "$RC" "start a branch from a title"
assert_eq "9.0-feature/keep_manual_order_date_on_confirmation" "$(git branch --show-current)" "...snake_case with the prefix"
assert_eq "$(git rev-parse origin/develop)" "$(git rev-parse HEAD)" "...cut from the remote integration branch"
assert_eq "" "$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)" "...without an upstream"
git checkout -q main
shuttle -y start "9.0-feature/already_prefixed"
assert_eq "9.0-feature/already_prefixed" "$(git branch --show-current)" "a name that already has the prefix is not prefixed twice"
git checkout -q main
shuttle -y start "Keep manual Order-Date, on confirmation!"
assert_status 1 "$RC" "start with a name that exists"
assert_contains "$OUT" "already exists" "...is refused"
shuttle -y start "!!!"
assert_status 1 "$RC" "a name without letters or digits"
shuttle -y start
assert_status 1 "$RC" "no name"
shuttle -y start one two
assert_status 1 "$RC" "two words not in quotes"
git config --unset shuttle.branchPrefix
shuttle -y start "second thing" --from release
assert_eq "feature/second_thing" "$(git branch --show-current)" "the default prefix is feature/"
assert_eq "$(git rev-parse origin/release)" "$(git rev-parse HEAD)" "...and --from picks another base"
echo dirty >> file.txt
shuttle -y start "third"
assert_status 1 "$RC" "start with uncommitted changes"
git checkout -q -- file.txt; git checkout -q main
shuttle -n start "dry one"
assert_status 0 "$RC" "start --dry-run"
assert_eq "no" "$(git show-ref -q --verify refs/heads/feature/dry_one && echo yes || echo no)" "...creates nothing"
git remote -v >/dev/null; git push -q origin main:refs/heads/feature/on_remote 2>/dev/null
shuttle -y start "on remote"
assert_status 1 "$RC" "a name that exists on the remote"

# --- pr ---------------------------------------------------------------------------------------------------------------------
git checkout -q -b feat/pr develop; echo p > p.txt; git add p.txt; git commit -q -m "[FIX] area: the title"
: > "$SB/gh.log"
shuttle -y pr --body "the text"
assert_status 0 "$RC" "pr"
assert_contains "$(cat "$SB/gh.log")" "pr create --base develop --head feat/pr --title [FIX] area: the title --body the text" "...asks gh for a pull request to the integration branch, titled from the last commit"
assert_eq "[FIX] area: the title" "$(remote_log feat/pr | head -1)" "...after pushing the branch"
echo "# body from a file" > "$SB/body.md"
shuttle -y pr --body-file "$SB/body.md" --title "My title" --base release --draft
assert_contains "$(tail -1 "$SB/gh.log")" "--base release --head feat/pr --title My title --body-file $SB/body.md --draft" "pr with a file, a title, another base and --draft"
shuttle -y pr --body a --body-file "$SB/body.md"
assert_status 1 "$RC" "a description given twice"
shuttle -y pr --body-file "$SB/missing.md"
assert_status 1 "$RC" "a description file that does not exist"
GH_FAIL=1 shuttle -y pr --body x
assert_status 2 "$RC" "gh failing"
assert_contains "$OUT" "gh could not open" "...says what to look at"
git checkout -q develop
shuttle -y pr --body x
assert_status 1 "$RC" "pr from a protected branch"
git checkout -q feat/pr
GIT_SHUTTLE_GH=no-such-gh-binary shuttle -y pr --body x
assert_status 1 "$RC" "pr without gh installed"
assert_contains "$OUT" "GitHub CLI" "...says what is missing"
n_before=$(wc -l < "$SB/gh.log")
shuttle -n pr --body x
assert_eq "$n_before" "$(wc -l < "$SB/gh.log")" "pr --dry-run does not call gh"

# --- ship --pr -----------------------------------------------------------------------------------------------------------------
git checkout -q -b feat/sp develop; echo s > s.txt; git add s.txt
: > "$SB/gh.log"
shuttle -y ship --pr -m "[IMP] area: through a pull request" --body "d" --title "Through a PR"
assert_status 0 "$RC" "ship --pr"
assert_eq "[IMP] area: through a pull request" "$(remote_log feat/sp | head -1)" "...commits and pushes the branch"
assert_contains "$(cat "$SB/gh.log")" "--head feat/sp --title Through a PR --body d" "...and opens the pull request"
assert_not_contains "$(remote_log develop | head -2)" "through a pull request" "...nothing was merged into the integration branch"
shuttle -y ship --pr --no-sync
assert_status 1 "$RC" "--pr with the merge options"
shuttle -y ship --title x
assert_status 1 "$RC" "pull request options without --pr"

# --- release --onto auto, candidates ----------------------------------------------------------------------------------------------
git checkout -q main
today=$(date +%Y%m%d)
git config shuttle.releasePattern "9.0-release/{yymmdd}-v1.{n}"
shuttle -n release --onto auto HEAD
assert_contains "$OUT" "9.0-release/${today:2}-v1.0" "a releasePattern with {yymmdd}"
git branch "9.0-release/${today:2}-v1.0"; git branch "9.0-release/${today:2}-v1.1"
shuttle -n release --onto auto HEAD
assert_contains "$OUT" "9.0-release/${today:2}-v1.2" "...takes the first free {n}"
git config shuttle.releasePattern "fixed-name"
git branch fixed-name
shuttle -n release --onto auto HEAD
assert_status 1 "$RC" "a pattern without {n} whose name is taken"
git config --unset shuttle.releasePattern

git checkout -q -b feat/c1 develop; echo c1 > c1.txt; git add c1.txt; git commit -q -m "c1 commit"
shuttle -y merge
git checkout -q -b feat/c2 develop; echo c2 > c2.txt; git add c2.txt; git commit -q -m "c2 first"; echo c22 > c22.txt; git add c22.txt; git commit -q -m "c2 second"
shuttle -y merge
git checkout -q main
shuttle candidates
assert_status 0 "$RC" "candidates"
assert_contains "$OUT" "Merge branch 'feat/c2' into develop" "...lists the merged branches"
assert_contains "$OUT" "c2 second" "...with their commits"
PJ=$(porcelain_json candidates --porcelain)
assert_eq "2" "$(pj candidate | grep -c .)" "candidates --porcelain: two merges"
assert_eq "3" "$(pj commit | grep -c .)" "...three commits in all"
assert_contains "$(pj commit)"  "+"$'\x1f'"c2 first" "...each marked + (not in the release branch yet)"
# one of them reaches the release branch by hand: it becomes '-'
git checkout -q -b manual release; git cherry-pick "$(git rev-parse feat/c1)" >/dev/null 2>&1; git push -q origin manual:release; git checkout -q main
PJ=$(porcelain_json candidates --porcelain)
assert_contains "$(pj commit)" "-"$'\x1f'"c1 commit" "a commit that is in the release branch is marked -"
assert_contains "$(pj commit)" "+"$'\x1f'"c2 second" "...the others stay +"
shuttle candidates --bogus
assert_status 1 "$RC" "candidates with an unknown argument"
# an empty list
git push -q origin develop:release 2>/dev/null || git push -q -f origin develop:release
shuttle candidates
assert_contains "$OUT" "no branch was merged" "nothing to release: says so"
PJ=$(porcelain_json candidates --porcelain)
assert_eq "" "$(pj candidate)" "...and an empty list in porcelain"

# --- the default name needs a repository without a branch called "release" ----------------------------------------------------
git checkout -q main
shuttle -n release --onto auto HEAD
assert_status 1 "$RC" "release --onto auto when a branch is called release (the default name would nest under it)"
assert_contains "$OUT" "branch names do not nest" "...says why"
git push -q origin release:prod; git push -q origin :release; git config shuttle.release prod; git fetch -q --prune origin; git branch -q -D release 2>/dev/null
shuttle -n release --onto auto HEAD
assert_contains "$OUT" "release/${today}-v1.0" "release --onto auto: the default pattern, with today's date"

# --- stage -------------------------------------------------------------------------------------------------------------------------
git checkout -q -b feat/stg main
echo n > "new file.txt"; mkdir -p dir; echo m > dir/m.txt
shuttle -y stage -- "new file.txt" dir/m.txt
assert_status 0 "$RC" "stage new files"
assert_eq "dir/m.txt"$'\n'"new file.txt" "$(git diff --cached --name-only | sort)" "...both are staged, a name with a space too"
shuttle -y stage -- nothing/here
assert_status 1 "$RC" "stage a path without changes"
shuttle -y stage
assert_status 1 "$RC" "stage without paths"
shuttle -y stage --bogus
assert_status 1 "$RC" "stage with an unknown option"
git reset -q; echo m2 > dir/m2.txt
before=$(git status --short | sort | md5sum)
shuttle -n stage -- dir/m2.txt
assert_status 0 "$RC" "stage --dry-run"
assert_eq "$before" "$(git status --short | sort | md5sum)" "...stages nothing"

finish
