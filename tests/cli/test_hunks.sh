#!/usr/bin/env bash
# shellcheck disable=SC2034  # PJ is read by pj, which is in sandbox.sh
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# One task with two revisions, picked into a release. The release branch changed line 7 by itself, and somebody else changed line 4 between the
# two revisions: the first revision conflicts on line 7; after it, the second one conflicts on line 4 (with the first revision, which is
# already on the release branch) and on line 7. Every conflict must say where it is, whose lines they are, and what the choice does.
sandbox_new
git config merge.conflictStyle diff3
nine() { local i; for i in 1 2 3 4 5 6 7 8 9; do echo "line $i"; done; }
setline() { local n=$1 text=$2; sed -i.bak "${n}s/.*/$text/" price.txt && rm -f price.txt.bak; }   # price.txt: line N becomes TEXT

git checkout -q release; nine > price.txt; git add price.txt; git commit -q -m "price list on release"
setline 7 "line 7 release"; git commit -q -am "release changes line 7"; git push -q origin release
git checkout -q develop; nine > price.txt; git add price.txt; git commit -q -m "price list on develop"
setline 4 "line 4 dev1"; setline 7 "line 7 dev1"; git commit -q -am "D1 first revision";  D1=$(git rev-parse HEAD)
setline 4 "line 4 mid";  git commit -q -am "E somebody else"
setline 4 "line 4 dev2"; setline 7 "line 7 dev2"; git commit -q -am "D2 second revision"; D2=$(git rev-parse HEAD)
git checkout -q main
unmerged() { git diff --name-only --diff-filter=U; }
conflict_text() { grep -c '^<<<<<<< ' price.txt || true; }

# --- the first revision: one place in conflict ---------------------------------------------------------------------------------------------
shuttle -y pick --onto rel/h "$D1" "$D2"
assert_status 2 "$RC" "the first revision conflicts"
assert_contains "$OUT" "commit 1 of 2, " "...commit 1 of 2"
assert_eq "price.txt" "$(unmerged)" "...in one file"
assert_eq "1" "$(conflict_text)" "...in one place"

shuttle conflicts
assert_status 0 "$RC" "conflicts, for a person"
assert_contains "$OUT" "price.txt: 1 place(s) in conflict" "...says how many places"
assert_contains "$OUT" "place 1: lines " "...and where"

PJ=$(porcelain_json conflicts price.txt --porcelain)
assert_eq "price.txt" "$(pj file)" "conflicts --porcelain: the file"
assert_eq "line 7 release" "$(pj ours | tr '\037' '|' | sed 's/^1|//')" "...the lines of your side (the release branch)"
assert_eq "line 7 dev1" "$(pj theirs | tr '\037' '|' | sed 's/^1|//')" "...the lines of the other side (the commit)"
assert_eq "line 7" "$(pj base | tr '\037' '|' | sed 's/^1|//')" "...what both started from (the file is in the diff3 style)"
assert_contains "$(pj before | tr '\037' '|')" "line 6" "...the lines before the place"
assert_contains "$(pj after | tr '\037' '|')" "line 8" "...and after it"
assert_contains "$(pj blame | tr '\037' '|')" "|release changes line 7|" "...who last changed the lines of your side: a commit of the release branch"
assert_eq "7" "$(pj hunk | tr '\037' '\n' | sed -n 4p)" "...where those lines are on the branch (the first of them)"

# the refusals
shuttle conflicts file.txt
assert_status 1 "$RC" "conflicts for a file that is not in conflict"
shuttle -y resolve --hunk 1=maybe -- price.txt
assert_status 1 "$RC" "a choice that does not exist"
shuttle -y resolve --hunk 2=ours -- price.txt
assert_status 1 "$RC" "a place that does not exist"
assert_contains "$OUT" "no place 2" "...says so"
shuttle -y resolve --hunk 1=ours --hunk 1=theirs -- price.txt
assert_status 1 "$RC" "the same place twice"
shuttle -y resolve --hunk 1=ours --ours -- price.txt
assert_status 1 "$RC" "places and a whole side together"
shuttle -y resolve --hunk 1=ours -- price.txt other.txt
assert_status 1 "$RC" "places in two files"
assert_eq "1" "$(conflict_text)" "...nothing was changed by the refusals"

# a dry run says what it would write, and writes nothing
shuttle -n resolve --hunk 1=both -- price.txt
assert_status 0 "$RC" "resolve --hunk --dry-run"
assert_contains "$OUT" "place 1: keep both, " "...says what it would do"
assert_eq "1" "$(conflict_text)" "...and the file still has its markers"

# both: the release's line, then the commit's
shuttle -y resolve --hunk 1=both -- price.txt
assert_status 0 "$RC" "keep both"
assert_eq "line 7 release|line 7 dev1" "$(sed -n 7,8p price.txt | paste -sd'|')" "...the release's line first, then the commit's"
assert_eq "0" "$(conflict_text)" "...no marker is left"
assert_eq "" "$(unmerged)" "...and the file is marked as resolved"
assert_contains "$OUT" "git checkout --merge" "...says how to take it back"
git checkout --merge -- price.txt
assert_eq "1" "$(conflict_text)" "git checkout --merge brings the place back, as the output says"
shuttle -y resolve --hunk 1=both -- price.txt

# --- the second revision: two places, and one of them is about the first revision --------------------------------------------------------------
shuttle -y continue
assert_status 2 "$RC" "continue: the first revision is in, the second one conflicts"
assert_contains "$OUT" "commit 2 of 2, " "...commit 2 of 2"
assert_eq "2" "$(conflict_text)" "...in two places"
PJ=$(porcelain_json conflicts price.txt --porcelain)
assert_eq "line 4 dev1" "$(pj ours | tr '\037' '|' | grep '^1|' | sed 's/^1|//')" "place 1: your side has the first revision's line"
assert_eq "line 4 dev2" "$(pj theirs | tr '\037' '|' | grep '^1|' | sed 's/^1|//')" "...the other side has the second revision's"
assert_eq "line 4 mid" "$(pj base | tr '\037' '|' | grep '^1|' | sed 's/^1|//')" "...and they started from what somebody else wrote"
assert_contains "$(pj blame | tr '\037' '|' | grep '^1|')" "|D1 first revision|" "...the lines of your side come from the first revision of the pick"
assert_eq "1" "$(pj blame | tr '\037' '|' | grep '^1|' | cut -d'|' -f6)" "...which is commit number 1 of this pick"
PJ=$(porcelain_json status --porcelain)
assert_eq "2" "$(pj pick.index)" "status: commit 2 of the pick is the one that is stuck"

# only one place decided: the file keeps the other one, and cannot be continued yet
shuttle -y resolve --hunk 1=theirs -- price.txt
assert_status 0 "$RC" "resolve one place of two"
assert_eq "1" "$(conflict_text)" "...the other place keeps its markers"
assert_eq "price.txt" "$(unmerged)" "...and the file is not marked as resolved"
assert_contains "$OUT" "still in conflict" "...says so"
assert_eq "line 4 dev2" "$(sed -n 4p price.txt)" "...the place that was decided has the commit's line"
shuttle -y continue
assert_status 1 "$RC" "continue with a place left"
assert_contains "$OUT" "conflict markers" "...is refused"

# the numbers are those of the file as it is now: what is left is place 1
PJ=$(porcelain_json conflicts price.txt --porcelain)
assert_eq "1" "$(pj hunk | tr '\037' '\n' | sed -n 1p)" "the place that is left is number 1 now"
shuttle -y resolve --hunk 1=theirs -- price.txt
assert_status 0 "$RC" "resolve the last place"
assert_eq "" "$(unmerged)" "...the file is marked as resolved"
shuttle -y continue
assert_status 0 "$RC" "continue finishes the release"
assert_eq "line 4 dev2" "$(sed -n 4p price.txt)" "...with the second revision on line 4"
assert_eq "line 7 dev2" "$(sed -n 7p price.txt)" "...and on line 7"
assert_eq "2" "$(git rev-list --count origin/release..HEAD)" "...two commits on top of the release branch"

# --- "base": back to what both started from -----------------------------------------------------------------------------------------------------
git checkout -q -b cb origin/release
shuttle -y cherry-pick "$D2"
assert_status 2 "$RC" "a cherry-pick that conflicts"
shuttle -y resolve --hunk 1=base --hunk 2=base -- price.txt
assert_status 0 "$RC" "take what both started from"
assert_eq "line 4 mid" "$(sed -n 4p price.txt)" "...line 4 is what it was before the commit"
shuttle -y abort

# without the diff3 style there is no base to go back to
git config merge.conflictStyle merge
git checkout -q -b cc origin/release
shuttle -y cherry-pick "$D2"
places=$(conflict_text)   # (without the diff3 style git joins two conflicts that are close together)
shuttle -y resolve --hunk 1=base -- price.txt
assert_status 1 "$RC" "base in a file that was not written in the diff3 style"
assert_eq "$places" "$(conflict_text)" "...nothing was changed"
shuttle -y abort

finish
