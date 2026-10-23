#!/usr/bin/env bash
# shellcheck disable=SC2034  # PJ is read by pj, which is in sandbox.sh
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# A release made of one task with three revisions, the first two of which touch what the release branch changed too: the conflicts come
# one after the other, and the commit that is stuck must be known every time. Nothing may be pushed while it is stuck.
sandbox_new
fake_gh
git checkout -q develop
echo "develop version" > clash.txt;   git add clash.txt; git commit -q -m "c1 revision 1";  C1=$(git rev-parse HEAD)
echo "develop version 2" > clash.txt; git add clash.txt; git commit -q -m "c2 revision 2";  C2=$(git rev-parse HEAD)
echo D > D.txt;                       git add D.txt;     git commit -q -m "c3 another file"; C3=$(git rev-parse HEAD)
git checkout -q release; echo "release version" > clash.txt; git add clash.txt; git commit -q -m "clash on release"; git push -q origin release
git checkout -q main
plan="$(git rev-parse --absolute-git-dir)/shuttle-pick"
remote_heads() { git ls-remote --heads origin | awk '{ print $2 }' | sort | tr '\n' ' '; }
before=$(for b in main develop release; do git rev-parse "origin/$b"; done)
steps() { pj pick.step | tr '\037' '|'; }

# --- stuck on the first commit -------------------------------------------------------------------------------------------------------------
shuttle -y pick --onto rel/p --push "$C1" "$C2" "$C3"
assert_status 2 "$RC" "a release of three commits: the first one conflicts"
assert_contains "$OUT" "commit 1 of 3, " "...says which commit is stuck, and how many there are"
assert_contains "$OUT" "git shuttle continue" "...says to continue"
assert_contains "$OUT" "pushes the branch at the end" "...and that the push waits for the end"
assert_contains "$OUT" "$C2" "...and lists what is still to pick"
assert_eq "rel/p" "$(git branch --show-current)" "...you are on the new branch"
assert_eq "yes" "$([[ -f "$plan" ]] && echo yes || echo no)" "...the plan is kept in the git folder"
assert_not_contains "$(remote_heads)" "rel/p" "...nothing was pushed"
PJ=$(porcelain_json status --porcelain)
assert_eq "3" "$(pj pick.total)" "status: the number of commits"
assert_eq "1" "$(pj pick.index)" "...the one that is stuck"
assert_eq "rel/p" "$(pj pick.branch)" "...the branch"
assert_eq "1" "$(pj pick.push)" "...that it is pushed at the end"
assert_contains "$(steps)" "current|$C1|c1 revision 1|" "...the commit that is stuck, with its title"
assert_contains "$(steps)" "todo|$C2|c2 revision 2|" "...the commits that come after"
assert_eq "" "$(pj release.ready)" "...no release is ready yet"

# --- keep what the release has: the commit has nothing left, and the pick goes on to the second ---------------------------------------------
shuttle -y resolve --ours -- clash.txt
assert_status 0 "$RC" "resolve: keep the release branch"
shuttle -y continue
assert_status 2 "$RC" "continue: the first commit is over, the second one conflicts"
assert_contains "$OUT" "nothing is left of this commit" "...the first one had nothing left after the resolution: it is skipped"
assert_contains "$OUT" "commit 2 of 3, " "...the second one is stuck"
PJ=$(porcelain_json status --porcelain)
assert_eq "2" "$(pj pick.index)" "status: the second commit is the one that is stuck"
assert_contains "$(steps)" "done|$C1|" "...the first is done"
assert_contains "$(steps)" "current|$C2|" "...the second is the current one"
assert_contains "$(steps)" "todo|$C3|" "...the third is still to come"
assert_not_contains "$(remote_heads)" "rel/p" "...still nothing pushed"

# --- take the commit's version: the rest is picked, and the branch is pushed ----------------------------------------------------------------
shuttle -y resolve --theirs -- clash.txt
assert_eq "develop version 2" "$(cat clash.txt)" "resolve: keep the commit's text"
shuttle -y continue
assert_status 0 "$RC" "continue: the second commit is finished and the third is picked"
assert_contains "$OUT" "'rel/p' is ready" "...says the release branch is ready"
assert_eq "c3 another file" "$(git log -1 --format=%s)" "...the last commit is on top"
assert_eq "c2 revision 2" "$(git log -2 --format=%s | tail -1)" "...the second under it (the first had nothing left)"
assert_eq "develop version 2" "$(cat clash.txt)" "...with the text that was kept"
assert_contains "$(remote_heads)" "refs/heads/rel/p" "...the branch was pushed, at the end, as asked"
assert_eq "$(git rev-parse HEAD)" "$(git rev-parse origin/rel/p)" "...with everything that was picked"
assert_eq "no" "$([[ -f "$plan" ]] && echo yes || echo no)" "...the plan is gone"
PJ=$(porcelain_json status --porcelain)
assert_eq "" "$(pj pick.total)" "status: no pick is waiting"
assert_eq "rel/p" "$(pj release.ready)" "...the release branch is ready for its pull request"
assert_eq "release" "$(pj release.base)" "...the pull request goes to the release branch"
assert_eq "1" "$(pj release.pushed)" "...and it is on the remote"

# --- the pull request ----------------------------------------------------------------------------------------------------------------------
shuttle -y pr --base release --title "Release" --body "the task"
assert_status 0 "$RC" "pr from the release branch"
assert_contains "$(cat "$SB/gh.log")" "pr create --base release --head rel/p" "...asks for a pull request to the release branch"
assert_eq "$before" "$(for b in main develop release; do git rev-parse "origin/$b"; done)" "main, develop and release on the remote were never touched"

# --- the pick is given up --------------------------------------------------------------------------------------------------------------------
shuttle -y pick --onto rel/q "$C1" "$C2"
assert_status 2 "$RC" "a pick without --push: stuck on the first commit"
shuttle -y abort
assert_status 0 "$RC" "abort"
assert_eq "no" "$([[ -f "$plan" ]] && echo yes || echo no)" "...the plan is forgotten"
assert_eq "" "$(git diff --name-only --diff-filter=U)" "...nothing is in conflict"
assert_eq "rel/q" "$(git branch --show-current)" "...you stay on the branch, with what was picked before"
shuttle -y continue
assert_status 1 "$RC" "continue after abort"
assert_contains "$OUT" "nothing is waiting" "...has nothing to go on with"
assert_not_contains "$(remote_heads)" "rel/q" "...and nothing was pushed"

# --- the stuck commit was finished by hand: continue goes on with the rest -------------------------------------------------------------------
shuttle -y pick --onto rel/r "$C1" "$C2"
assert_status 2 "$RC" "a pick: stuck on the first commit"
git checkout -q --ours clash.txt && git add clash.txt && git cherry-pick --skip >/dev/null 2>&1
assert_eq "" "$(git rev-parse -q --verify CHERRY_PICK_HEAD || true)" "the first commit is given up by hand, with git itself"
shuttle -y continue
assert_status 2 "$RC" "continue: the pick goes on by itself, with what was left"
assert_contains "$OUT" "commit 2 of 2, " "...and the second commit is the one that is stuck"
shuttle -y abort

# --- a dry run changes nothing and makes no plan -------------------------------------------------------------------------------------------
shuttle -n pick --onto rel/d "$C1" "$C2"
assert_status 0 "$RC" "pick --dry-run"
assert_eq "no" "$([[ -f "$plan" ]] && echo yes || echo no)" "...makes no plan"
assert_eq "no" "$(git show-ref -q --verify refs/heads/rel/d && echo yes || echo no)" "...and no branch"

# --- cherry-pick onto a branch, with --push: the same, and the push is done at the end -----------------------------------------------------
git checkout -q -b cp2 origin/release
shuttle -y cherry-pick --push "$C1" "$C3"
assert_status 2 "$RC" "cherry-pick --push: the first commit conflicts"
assert_contains "$OUT" "commit 1 of 2, " "...says which one"
assert_not_contains "$(remote_heads)" "cp2" "...nothing was pushed"
shuttle -y resolve --theirs -- clash.txt
shuttle -y continue
assert_status 0 "$RC" "continue: both commits are on the branch"
assert_contains "$(remote_heads)" "refs/heads/cp2" "...and the branch was pushed at the end"
assert_eq "c3 another file" "$(git log -1 --format=%s)" "...the last commit is on top"

finish
