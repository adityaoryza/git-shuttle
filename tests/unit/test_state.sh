#!/usr/bin/env bash
# shellcheck source=../lib/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
# shellcheck source=../lib/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/sandbox.sh"

sandbox_new
conflict_on_develop() { # a rebase that stops: feature and develop both change clash.txt (a new text each time)
    git checkout -q -b "$1" develop; echo "mine $1" > clash.txt; git add clash.txt; git commit -q -m "mine"
    remote_commit develop clash.txt "theirs $1" "theirs $1"
}

# --- status --porcelain ----------------------------------------------------------------------------------------------
feature feat/p
PJ=$(porcelain_json status --porcelain)
assert_eq "feat/p" "$(pj branch)" "porcelain: the branch"
assert_eq "my work" "$(pj repo.name)" "...the repository name, with its space"
assert_eq "0" "$(pj protected)" "...not protected"
assert_eq "develop" "$(pj config.integration)" "...the settings"
assert_eq "origin/develop" "$(pj integration.ref)" "...the integration reference"
assert_eq "1" "$(pj integration.ahead)" "...ahead of it by one commit"
assert_contains "$(pj blocker)" "" "...no blocker when a commit is ahead"
assert_eq "" "$(pj blocker)" "...really none"
echo "new" > "a file with spaces.txt"; echo x > feat/p.txt; git add "a file with spaces.txt"
mkdir -p dir; echo y > dir/b.txt; git add dir/b.txt; git mv file.txt moved.txt 2>/dev/null || true
PJ=$(porcelain_json status --porcelain)
assert_contains "$(pj file)" "A  a file with spaces.txt" "files: a name with spaces"
assert_contains "$(pj file)" "A  dir/b.txt" "...a path in a folder"
assert_contains "$(pj file)" "moved.txt" "...a rename is one record, not two"
assert_not_contains "$(pj file)" "file.txt"$'\n'"file.txt" "...and its old name is not a second record"
git reset -q --hard; git clean -fdq
git checkout -q develop
PJ=$(porcelain_json status --porcelain)
assert_eq "1" "$(pj protected)" "a protected branch"
assert_contains "$(pj blocker)" "protected branch" "...is a blocker"
git checkout -q --detach
PJ=$(porcelain_json status --porcelain)
assert_eq "" "$(pj branch)" "a detached HEAD has no branch"
assert_contains "$(pj blocker)" "detached" "...and is a blocker"
git checkout -q feat/p; git reset -q --hard
git checkout -q -b feat/empty develop
PJ=$(porcelain_json status --porcelain)
assert_contains "$(pj blocker)" "nothing to ship" "a branch with nothing staged and nothing ahead: nothing to ship"
echo odd > $'odd\nname.txt'; git add -A
PJ=$(porcelain_json status --porcelain)
assert_eq "1" "$(pj staged)" "a file name with a newline"
assert_contains "$(pj file)" "odd" "...does not break the records"
git reset -q --hard; git clean -fdq
shuttle status --porcelain
assert_status 0 "$RC" "status --porcelain"
shuttle status --bogus
assert_status 1 "$RC" "status with an unknown argument"

# --- an operation that waits ------------------------------------------------------------------------------------------
conflict_on_develop feat/rb
shuttle -y sync
assert_status 2 "$RC" "a rebase that stops"
PJ=$(porcelain_json status --porcelain)
assert_eq "rebase" "$(pj operation)" "status says a rebase is waiting"
assert_eq "clash.txt" "$(pj conflict)" "...and which file is in conflict"
assert_contains "$(pj blocker)" "rebase is waiting" "...it blocks a ship"
for cmd in "commit -m x" "sync" "merge" "push" "ship" "start thing" "pr" "pick --onto r1 HEAD"; do
    # shellcheck disable=SC2086  # $cmd is a command line on purpose
    shuttle -y $cmd
    case "$cmd" in push) ;; *) assert_status 1 "$RC" "'$cmd' while a rebase waits"; assert_contains "$OUT" "waiting to be finished" "...is refused, with the way out" ;; esac
done
shuttle -y continue
assert_status 1 "$RC" "continue with the conflict markers still in the file"
assert_contains "$OUT" "clash.txt" "...names the file"
assert_eq "yes" "$([[ -n "$(git diff --name-only --diff-filter=U)" ]] && echo yes || echo no)" "...and the file is still in conflict"
echo "resolved" > clash.txt
shuttle -y continue
assert_status 0 "$RC" "continue after the file is resolved"
assert_eq "no" "$([[ -d "$(git rev-parse --git-path rebase-merge)" ]] && echo yes || echo no)" "...the rebase is over"
assert_eq "resolved" "$(cat clash.txt)" "...with the resolution kept"
shuttle -y continue
assert_status 1 "$RC" "continue with nothing waiting"

# --- abort: the three kinds ----------------------------------------------------------------------------------------------------
git checkout -q develop; git reset -q --hard origin/develop; git fetch -q
conflict_on_develop feat/rb2
head_before=$(git rev-parse HEAD)
shuttle -y sync
shuttle -y abort
assert_status 0 "$RC" "abort a rebase"
assert_eq "$head_before" "$(git rev-parse HEAD)" "...the branch is as it was"
shuttle -y abort
assert_status 1 "$RC" "abort with nothing waiting"

git checkout -q -b feat/mg develop; echo "branch side" > clash2.txt; git add clash2.txt; git commit -q -m "branch side"
git checkout -q -b other develop; echo "other side" > clash2.txt; git add clash2.txt; git commit -q -m "other side"
git merge --no-ff -m "merge" feat/mg >/dev/null 2>&1
PJ=$(porcelain_json status --porcelain)
assert_eq "merge" "$(pj operation)" "a merge that stops is seen"
shuttle -y continue
assert_status 1 "$RC" "continue a merge with markers in the file"
echo "both" > clash2.txt
shuttle -y continue
assert_status 0 "$RC" "continue a merge once resolved"
assert_eq "merge" "$(git log -1 --format=%s)" "...the merge commit is made"
git reset -q --hard HEAD~1
git merge --no-ff -m "merge" feat/mg >/dev/null 2>&1
shuttle -y abort
assert_status 0 "$RC" "abort a merge"
assert_eq "no" "$([[ -f "$(git rev-parse --git-path MERGE_HEAD)" ]] && echo yes || echo no)" "...nothing is left waiting"

git checkout -q -b pick-target develop; echo "target" > clash3.txt; git add clash3.txt; git commit -q -m "target"
git checkout -q -b src develop~0; git checkout -q develop; git checkout -q -b src2 develop; echo "src" > clash3.txt; git add clash3.txt; git commit -q -m "src"
SRC=$(git rev-parse HEAD); git checkout -q pick-target
git cherry-pick "$SRC" >/dev/null 2>&1
PJ=$(porcelain_json status --porcelain)
assert_eq "cherry-pick" "$(pj operation)" "a cherry-pick that stops is seen"
echo "ok" > clash3.txt
shuttle -y continue
assert_status 0 "$RC" "continue a cherry-pick once resolved"
git reset -q --hard HEAD~1
git cherry-pick "$SRC" >/dev/null 2>&1
shuttle -y abort
assert_status 0 "$RC" "abort a cherry-pick"
assert_eq "target" "$(git log -1 --format=%s)" "...back where it was"
shuttle -n abort
assert_status 1 "$RC" "abort --dry-run with nothing waiting"

finish
