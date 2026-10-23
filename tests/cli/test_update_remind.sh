#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# A command of git-shuttle looks for a newer release by itself, in the background (update_remind), and says so once on a terminal.
sandbox_new
unset GIT_SHUTTLE_NO_UPDATE_CHECK
export XDG_CONFIG_HOME="$SB/xdg" GIT_SHUTTLE_REPO="http://127.0.0.1:9"       # nothing answers there: the look fails at once
NOTICE="$XDG_CONFIG_HOME/git-shuttle/update-notice.json"
waitfor() { for _ in {1..60}; do [[ -s "$NOTICE" ]] && return 0; sleep 0.2; done; return 1; }

GIT_SHUTTLE_NO_UPDATE_CHECK=1 shuttle status
sleep 1
[[ -e "$NOTICE" ]] && made=yes || made=no
assert_eq "no" "$made" "with GIT_SHUTTLE_NO_UPDATE_CHECK=1 a command looks at nothing"

shuttle update --check
shuttle version
sleep 1
[[ -e "$NOTICE" ]] && made=yes || made=no
assert_eq "no" "$made" "version and update do not start a look"

shuttle status
assert_status 0 "$RC" "a command still works while the look is made"
waitfor && made=yes || made=no
assert_eq "yes" "$made" "a command starts a look in the background: the answer is kept for the page"
assert_contains "$(cat "$NOTICE")" '"checked"' "...with the time of the look (also when it failed)"

before=$(stat -c %Y "$NOTICE")
sleep 1.2
shuttle status
sleep 1
assert_eq "$before" "$(stat -c %Y "$NOTICE")" "within ten minutes the next command makes no look"

# a newer release is known: one line on a terminal, once
echo '{"latest": "99.0.0", "checked": 1}' >"$NOTICE"
touch "$NOTICE"
with_tty "" "$SHUTTLE" status
assert_contains "$OUT" "git-shuttle 99.0.0 is out" "a newer release is told on a terminal"
with_tty "" "$SHUTTLE" status
assert_not_contains "$OUT" "99.0.0 is out" "...once for each release"
rm -f "$XDG_CONFIG_HOME/git-shuttle/update-told"
shuttle status --porcelain
assert_not_contains "$OUT" "is out" "nothing is printed in a command for scripts"
echo '{"latest": "99.0.0", "snoozed": "99.0.0"}' >"$NOTICE"; touch "$NOTICE"
with_tty "" "$SHUTTLE" status
assert_not_contains "$OUT" "99.0.0 is out" "a release that was put off ('Later') is not told"
echo '{"latest": "99.0.0", "enabled": false}' >"$NOTICE"; touch "$NOTICE"
with_tty "" "$SHUTTLE" status
assert_not_contains "$OUT" "99.0.0 is out" "...nor when the reminder is turned off"

finish
