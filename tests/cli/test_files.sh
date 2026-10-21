#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
feature feat/files
mkdir -p dir
echo one > dir/a.txt; echo two > dir/b.txt; echo three > c.txt
git add -A; git commit -q -m "files"
staged() { git diff --cached --name-only | tr '\n' ' '; }

# --- stage and unstage ------------------------------------------------------------------------------------------------------------
echo change >> dir/a.txt; echo change >> c.txt; echo brand-new > new.txt
shuttle -y stage -- dir/a.txt new.txt
assert_eq "dir/a.txt new.txt " "$(staged)" "stage two files"
shuttle -y unstage -- dir/a.txt
assert_status 0 "$RC" "unstage a file"
assert_eq "new.txt " "$(staged)" "...only that one leaves the next commit"
assert_contains "$(cat dir/a.txt)" "change" "...and its change stays in the working tree"
shuttle -y unstage -- dir/a.txt
assert_status 1 "$RC" "unstage what is not staged"
assert_contains "$OUT" "nothing is staged" "...says so"
shuttle -y unstage
assert_status 1 "$RC" "unstage without paths"
shuttle -y unstage --nope -- x
assert_status 1 "$RC" "an option that does not exist"
shuttle -y unstage -- dir
assert_status 1 "$RC" "a folder with nothing staged in it"
shuttle -n unstage -- new.txt
assert_contains "$OUT" "git restore --staged -- new.txt" "a dry run shows the command"
assert_eq "new.txt " "$(staged)" "...and changes nothing"
shuttle -y unstage -- new.txt; shuttle -y stage -- new.txt
shuttle -y unstage -- 'dir/*.txt'
assert_status 1 "$RC" "a pattern is not expanded by git-shuttle: it is a name (and no file has it)"
git reset -q

# --- discard ------------------------------------------------------------------------------------------------------------------------
shuttle -y discard -- c.txt
assert_status 0 "$RC" "discard the changes of a tracked file"
assert_eq "three" "$(cat c.txt)" "...it is back to the commit"
assert_contains "$(cat dir/a.txt)" "change" "...other files are not touched"
shuttle -y discard -- c.txt
assert_status 1 "$RC" "discard what has no changes"
assert_contains "$OUT" "nothing to discard" "...says so"
shuttle -y discard -- new.txt
assert_status 1 "$RC" "an untracked file needs --untracked"
assert_eq "brand-new" "$(cat new.txt)" "...and is still there"
mkdir -p newdir; echo x > newdir/f.txt
shuttle -y discard --untracked -- new.txt
assert_status 0 "$RC" "discard an untracked file when asked"
assert_eq "" "$(ls new.txt 2>/dev/null)" "...it is deleted"
assert_eq "x" "$(cat newdir/f.txt)" "...a folder you did not name is not touched"
shuttle -y discard --untracked -- newdir
assert_eq "" "$(ls newdir/f.txt 2>/dev/null)" "a file inside a named folder goes, as the file it is"
rmdir newdir 2>/dev/null
echo ignored > skip.log; echo "*.log" > .gitignore; git add .gitignore; git commit -q -m ignore
shuttle -y discard --untracked -- skip.log
assert_status 1 "$RC" "an ignored file is never deleted"
assert_eq "ignored" "$(cat skip.log)" "...it is still there"

# staged changes: kept unless --staged
echo more >> dir/b.txt; git add dir/b.txt
echo again >> dir/b.txt
shuttle -y discard -- dir/b.txt
assert_eq "dir/b.txt " "$(staged)" "without --staged what is staged stays staged"
assert_eq "$(git show :dir/b.txt)" "$(cat dir/b.txt)" "...and the working tree goes back to the staged version"
shuttle -y discard --staged -- dir/b.txt
assert_status 0 "$RC" "discard with --staged"
assert_eq "two" "$(cat dir/b.txt)" "...goes back to the commit"
assert_eq "" "$(staged)" "...and nothing is staged"
shuttle -n discard -- dir/a.txt
assert_contains "$OUT" "git restore -- dir/a.txt" "a dry run shows the command"
assert_contains "$(cat dir/a.txt)" "change" "...and discards nothing"
shuttle -y discard -- ../outside
assert_status 1 "$RC" "a path outside the repository"
shuttle -y discard --bogus -- c.txt
assert_status 1 "$RC" "an unknown option"
shuttle -y discard
assert_status 1 "$RC" "no paths"

# --- not during a waiting rebase; not before the first commit ------------------------------------------------------------------------
git checkout -q -b clash1 main; echo a > clash.txt; git add clash.txt; git commit -q -m a
git checkout -q -b clash2 main; echo b > clash.txt; git add clash.txt; git commit -q -m b
git rebase clash1 >/dev/null 2>&1
shuttle -y unstage -- clash.txt
assert_status 1 "$RC" "refused while a rebase waits"
shuttle -y discard -- clash.txt
assert_status 1 "$RC" "refused while a rebase waits"
git rebase --abort >/dev/null 2>&1
git init -q "$SB/empty" && cd "$SB/empty" && echo x > f.txt && git add f.txt
shuttle -y unstage -- f.txt
assert_status 0 "$RC" "unstage in a repository without a first commit"
assert_eq "" "$(git diff --cached --name-only)" "...works"
shuttle -y discard -- f.txt
assert_status 1 "$RC" "discard before the first commit"

finish
