#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
git config shuttle.messagePattern '^\[[A-Z]+\] .+'
git checkout -q -b feat/r develop
for n in a b c d; do echo "$n" > "$n.txt"; git add "$n.txt"; git commit -q -m "[ADD] $n"; done
base=$(git rev-parse develop)
sha() { git rev-parse "HEAD~$1"; }
subjects() { git log --reverse --format=%s "$base..HEAD" | tr '\n' ',' ; }
a=$(sha 3); b=$(sha 2); c=$(sha 1); d=$(sha 0)
assert_eq "[ADD] a,[ADD] b,[ADD] c,[ADD] d," "$(subjects)" "setup"

# --- drop / move ---------------------------------------------------------------------------------------------------------------------
shuttle -y drop "$b"
assert_status 0 "$RC" "drop a commit"
assert_eq "[ADD] a,[ADD] c,[ADD] d," "$(subjects)" "...it is out"
assert_eq "" "$(ls b.txt 2>/dev/null)" "...with its file"
shuttle -y undo
assert_status 0 "$RC" "undo it"
assert_eq "[ADD] a,[ADD] b,[ADD] c,[ADD] d," "$(subjects)" "...all four are back"
shuttle -y move "$d" down
assert_status 0 "$RC" "move a commit down"
assert_eq "[ADD] a,[ADD] b,[ADD] d,[ADD] c," "$(subjects)" "...swapped with its neighbour"
shuttle -y move "$(git log -1 --format=%H --grep='\[ADD\] b')" up
assert_eq "[ADD] a,[ADD] d,[ADD] b,[ADD] c," "$(subjects)" "move up"
shuttle -y undo; shuttle -y undo
assert_eq "[ADD] a,[ADD] b,[ADD] c,[ADD] d," "$(subjects)" "two undos bring the order back"
a=$(sha 3); b=$(sha 2); c=$(sha 1); d=$(sha 0)
shuttle -y move "$d" up
assert_status 1 "$RC" "the newest cannot move up"
shuttle -y move "$a" down
assert_status 1 "$RC" "moving the oldest down would rewrite a pushed commit"
assert_contains "$OUT" "--allow-pushed" "...says how"
assert_eq "[ADD] a,[ADD] b,[ADD] c,[ADD] d," "$(subjects)" "...and changes nothing"

# --- rewrite -------------------------------------------------------------------------------------------------------------------------
shuttle -y rewrite "$base" "pick:$a" "reword:$b" "pick:$c" "pick:$d" --message "$b=[FIX] better words"
assert_status 0 "$RC" "reword one commit"
assert_eq "[ADD] a,[FIX] better words,[ADD] c,[ADD] d," "$(subjects)" "...only its message changed"
assert_eq "b" "$(git show "HEAD~2:b.txt")" "...and its content"
shuttle -y undo
a=$(sha 3); b=$(sha 2); c=$(sha 1); d=$(sha 0)
shuttle -y rewrite "$base" "pick:$a" "squash:$b" "fixup:$c" "pick:$d"
assert_status 0 "$RC" "squash and fixup"
assert_eq "2" "$(git rev-list --count "$base..HEAD")" "...two commits are left"
assert_contains "$(git log --format=%B "$base..HEAD~1")" "[ADD] b" "...squash keeps the message of the melted commit"
assert_not_contains "$(git log --format=%B "$base..HEAD~1")" "[ADD] c" "...fixup does not"
assert_eq "a.txt b.txt c.txt" "$(git diff --name-only "$base" HEAD~1 | tr '\n' ' ' | sed 's/ $//')" "...all their files are in it"
shuttle -y undo
a=$(sha 3); b=$(sha 2); c=$(sha 1); d=$(sha 0)
shuttle -y rewrite "$base" "pick:$d" "pick:$a" "pick:$b" "pick:$c"
assert_status 0 "$RC" "reorder"
assert_eq "[ADD] d,[ADD] a,[ADD] b,[ADD] c," "$(subjects)" "...the new order"
shuttle -y undo
a=$(sha 3); b=$(sha 2); c=$(sha 1); d=$(sha 0)
for bad in "rewrite $base pick:$a pick:$b pick:$c" "rewrite $base pick:$a pick:$a pick:$b pick:$c pick:$d" "rewrite $base squash:$a pick:$b pick:$c pick:$d" \
           "rewrite $base wipe:$a pick:$b pick:$c pick:$d" "rewrite $base pick:$a pick:$b pick:$c pick:nope" \
           "rewrite $base reword:$a pick:$b pick:$c pick:$d" "rewrite $base pick:$a pick:$b pick:$c pick:$d --message $a=" "rewrite $base" "rewrite" \
           "rewrite $base drop:$a pick:$b pick:$c pick:$d --message $a=x" "rewrite --evil pick:$a" "rewrite $base pick:$a pick:$b pick:$c pick:$d --message $d=bad_message_style"; do
    # shellcheck disable=SC2086
    shuttle -y $bad
    assert_status 1 "$RC" "refused: ${bad//$base/BASE}"
done
assert_eq "[ADD] a,[ADD] b,[ADD] c,[ADD] d," "$(subjects)" "...none of them changed anything"
git checkout -q develop
shuttle -y drop "$d"
assert_status 1 "$RC" "a protected branch"
git checkout -q feat/r

# --- pushed and conflicts ------------------------------------------------------------------------------------------------------------
git push -q -u origin feat/r
d=$(git rev-parse HEAD)
shuttle -y drop "$d"
assert_status 1 "$RC" "a pushed commit is not rewritten"
assert_contains "$OUT" "--allow-pushed" "...says how"
shuttle -y drop "$d" --allow-pushed
assert_status 0 "$RC" "...unless told"
assert_contains "$OUT" "push --force-with-lease" "...and says what the next push needs"
git reset -q --hard "$d"; git push -q --force origin feat/r
echo changed > b.txt; git commit -q -am "[FIX] b again"
f=$(git rev-parse HEAD); a=$(git rev-parse "HEAD~4"); b=$(git rev-parse "HEAD~3")
shuttle -y drop "$b" --allow-pushed
assert_status 2 "$RC" "a drop that conflicts stops"
shuttle -y abort
assert_status 0 "$RC" "...and can be given up"
assert_eq "$f" "$(git rev-parse HEAD)" "...the branch is as it was"
: "$a"

finish
