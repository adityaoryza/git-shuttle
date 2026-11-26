#!/usr/bin/env bash
# The trace follows commits that a rebase, a conflict resolved with continue, or an amend rewrote: a report never names a commit that only
# existed before the rewrite (seen on a real task: ship rebased a second commit of the branch and the report missed it).
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/t
git config branch.feat/t.shuttle-ref-addon odoo-task
git config branch.feat/t.shuttle-ref-id 4242
TRACE="$(git rev-parse --path-format=absolute --git-common-dir)/shuttle-trace/events.jsonl"

# commit_event SUBJECT — "sha was subject" of the commit event with that subject (the last one)
commit_event() {
    python3 -c 'import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows=[r for r in rows if r.get("type")=="commit" and r.get("subject","").startswith(sys.argv[2])]
r=rows[-1] if rows else {}
print(r.get("sha",""), r.get("was",""), r.get("subject",""))' "$TRACE" "$1"
}

# --- a rebase by sync ---------------------------------------------------------------------------------------------------------------------
echo one > one.txt; git add one.txt
shuttle -y commit -m "[FIX] root: first change" -- one.txt
assert_status 0 "$RC" "a commit on a branch for a task"
old=$(git rev-parse HEAD)
read -r sha was _ <<<"$(commit_event "[FIX] root: first change")"
assert_eq "$old" "$sha" "...is traced with its sha"

remote_commit develop other.txt "from someone else" "someone else's work"
shuttle -y sync
assert_status 0 "$RC" "sync rebases the branch on the moved integration branch"
new=$(git rev-parse HEAD)
assert_eq "yes" "$([[ "$old" != "$new" ]] && echo yes || echo no)" "...which rewrites the commit"
read -r sha was _ <<<"$(commit_event "[FIX] root: first change")"
assert_eq "$new" "$sha" "...and the trace now names the rewritten commit"
assert_eq "$old" "$was" "...and keeps the old one in 'was'"

# --- a rebase that stops on a conflict, finished with continue -------------------------------------------------------------------------------
echo "mine" > file.txt
shuttle -y commit -m "[FIX] root: my line" -- file.txt
old=$(git rev-parse HEAD)
remote_commit develop file.txt "theirs" "a change of file.txt on develop"
shuttle -y sync
assert_status 2 "$RC" "sync that hits a conflict"
echo "resolved" > file.txt
shuttle -y continue
assert_status 0 "$RC" "continue finishes the rebase"
new=$(git rev-parse HEAD)
read -r sha was _ <<<"$(commit_event "[FIX] root: my line")"
assert_eq "$new" "$sha" "...and the trace names the commit as it is after the resolution"
assert_eq "$old" "$was" "...with the old one in 'was'"
read -r sha _ _ <<<"$(commit_event "[FIX] root: first change")"
assert_eq "$(git rev-parse HEAD~1)" "$sha" "...and the commit before it too"

# --- an amend of the message ---------------------------------------------------------------------------------------------------------------
old=$(git rev-parse HEAD)
shuttle -y amend -m "[FIX] root: my line, reworded"
assert_status 0 "$RC" "amend of the last commit"
read -r sha was subject <<<"$(commit_event "[FIX] root: my line")"
assert_eq "$(git rev-parse HEAD)" "$sha" "...the trace names the amended commit"
assert_eq "$old" "$was" "...the old one in 'was'"
assert_contains "$subject" "reworded" "...and its new subject"

# --- a dry run rewrites nothing ---------------------------------------------------------------------------------------------------------------
before=$(cat "$TRACE")
remote_commit develop third.txt "more" "more work on develop"
shuttle -n sync
assert_eq "$before" "$(cat "$TRACE")" "a dry run of sync leaves the trace as it was"
assert_eq "600" "$(stat -c %a "$TRACE" 2>/dev/null || stat -f %Lp "$TRACE")" "the trace stays private after a rewrite"

finish
