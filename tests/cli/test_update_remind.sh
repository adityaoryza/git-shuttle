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

# commands that start while the first look is on its way make no look of their own
rm -f "$NOTICE"
cat >"$SB/slow.py" <<'PY'
import http.server, sys, time
hits = open(sys.argv[2], "w")
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        hits.write("x\n"); hits.flush(); time.sleep(2)
        if self.path.endswith("/tag/v9.9.9"):
            self.send_response(200); self.end_headers(); return
        self.send_response(302); self.send_header("Location", self.path + "/tag/v9.9.9"); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$SB/slow.py" 18772 "$SB/hits" & SLOW=$!
for _ in {1..30}; do (echo >/dev/tcp/127.0.0.1/18772) 2>/dev/null && break; sleep 0.1; done
export GIT_SHUTTLE_REPO="http://127.0.0.1:18772"
for _ in 1 2 3 4 5; do shuttle status --porcelain; sleep 0.2; done
sleep 5
kill "$SLOW" 2>/dev/null
hits=$(wc -l <"$SB/hits")
(( hits <= 2 )) && few=yes || few=no
assert_eq "yes" "$few" "five quick commands make one look, not five (the release server got $hits requests)"

finish
