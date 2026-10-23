# shellcheck shell=bash
# A throw-away world for a test: a bare "remote", a working clone with a base branch, an integration branch and a
# release branch, and a git that ignores the configuration of whoever runs the tests.

SHUTTLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)/bin/git-shuttle"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 NO_COLOR=1
export GIT_AUTHOR_NAME=Tester GIT_AUTHOR_EMAIL=tester@example.com GIT_COMMITTER_NAME=Tester GIT_COMMITTER_EMAIL=tester@example.com
export GIT_EDITOR=true GIT_TERMINAL_PROMPT=0

# sandbox_new [DIRNAME] — creates $SB (the root), $REMOTE (bare) and $WORK (the clone, with spaces in its path on purpose).
sandbox_new() {
    export GIT_SHUTTLE_NO_UPDATE_CHECK=1     # a command looks for a newer release by itself (update_remind): not in a test, unless it is about that
    SB=$(mktemp -d "${TMPDIR:-/tmp}/shuttle-test.XXXXXX")
    REMOTE="$SB/remote.git"
    WORK="$SB/${1:-my work}"
    git init -q --bare -b main "$REMOTE"
    git clone -q "$REMOTE" "$WORK" 2>/dev/null
    (
        cd "$WORK" || exit 1
        git checkout -q -b main
        echo base > file.txt; git add file.txt; git commit -q -m "base"
        git push -q -u origin main
        git checkout -q -b develop; echo dev >> file.txt; git commit -q -am "develop start"; git push -q -u origin develop
        git checkout -q -b release main; git push -q -u origin release
        git checkout -q main
        git remote set-head origin main >/dev/null 2>&1
    )
    git -C "$REMOTE" symbolic-ref HEAD refs/heads/main
    cd "$WORK" || return 1
    git config shuttle.integration develop
    git config shuttle.release release
    trap 'rm -rf "$SB"' EXIT
}

# feature NAME [FILE] — a branch from develop with one commit.
feature() {
    local file=${2:-$1.txt}
    git checkout -q -b "$1" develop
    mkdir -p "$(dirname "$file")"
    echo "$1" > "$file"; git add "$file"; git commit -q -m "work on $1"
}

# shuttle ARGS... — runs the tool; output in $OUT, status in $RC.
# shellcheck disable=SC2034  # OUT and RC are read by the tests
shuttle() { OUT=$("$SHUTTLE" "$@" 2>&1); RC=$?; }

# remote_log BRANCH — one line per commit of a branch on the remote.
remote_log() { git -C "$REMOTE" log --format='%s' "$1"; }

# with_tty ANSWERS CMD... — runs CMD on a pseudo terminal and types an answer (and Enter) each time it asks: a prompt ends
# with "[Y/n] " or ": ". ANSWERS is one answer, or several separated by "|" (one per prompt, the last one repeats).
# Output in $OUT, status in $RC. Needed to test the prompts: a pipe cannot answer them.
# shellcheck disable=SC2034  # OUT and RC are read by the tests
with_tty() {
    local answers=$1; shift
    OUT=$(python3 - "$answers" "$@" <<'PY'
import os, pty, select, sys, time
answers, argv = sys.argv[1].split("|"), sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
out, seen, given, deadline = b"", 0, 0, time.time() + 30
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
        tail = out[seen:]
        if tail.endswith(b"[Y/n] ") or tail.endswith(b": "):
            answer = answers[min(given, len(answers) - 1)]
            os.write(fd, (answer + "\n").encode())
            given += 1
            seen = len(out)
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode(errors="replace").replace("\r", ""))
sys.exit(os.waitstatus_to_exitcode(status))
PY
    ); RC=$?
}

# remote_commit BRANCH FILE CONTENT MESSAGE — someone else pushes a commit to a branch of the remote.
remote_commit() {
    local tmp="$SB/other"
    rm -rf "$tmp"
    git clone -q "$REMOTE" "$tmp" 2>/dev/null
    ( cd "$tmp" && git checkout -q "$1" && mkdir -p "$(dirname "$2")" && printf '%s\n' "$3" > "$2" \
        && git add "$2" && git commit -q -m "$4" && git push -q origin "$1" )
    rm -rf "$tmp"
}

# reject_pushes BRANCH — the remote refuses every push to a branch (to test a rejected push).
reject_pushes() {
    # shellcheck disable=SC2016  # the hook script is written literally: $old, $new and $ref are for the hook
    printf '#!/bin/sh\nwhile read old new ref; do [ "$ref" = "refs/heads/%s" ] && { echo "rejected by the test" >&2; exit 1; }; done\nexit 0\n' "$1" \
        > "$REMOTE/hooks/pre-receive"
    chmod +x "$REMOTE/hooks/pre-receive"
}

# porcelain_json — `git shuttle status --porcelain` as JSON, to read it in a test ($OUT); repeated keys become lists.
porcelain_json() {
    "$SHUTTLE" "$@" 2>/dev/null | python3 -c '
import json, sys
out = {}
for rec in sys.stdin.buffer.read().split(b"\0"):
    if not rec: continue
    k, _, v = rec.decode(errors="replace").partition("=")
    if k in ("file", "conflict", "blocker", "candidate", "commit", "pick.step", "hunk", "before", "ours", "base", "theirs", "after", "blame"): out.setdefault(k, []).append(v)
    else: out[k] = v
print(json.dumps(out))'
}

# pj KEY — a value of the last porcelain_json (in $PJ), empty when absent.
pj() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); v=d.get(sys.argv[2], ""); print("\n".join(v) if isinstance(v, list) else v)' "$PJ" "$1"; }

# fake_gh — a gh that logs its arguments to $SB/gh.log, and fails when GH_FAIL=1.
fake_gh() {
    mkdir -p "$SB/bin"
    cat > "$SB/bin/gh" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$(dirname "$0")/../gh.log"
[ "${GH_FAIL:-0}" = 1 ] && { echo "gh: boom" >&2; exit 1; }
echo "https://example.com/pull/1"
SH
    chmod +x "$SB/bin/gh"
    GIT_SHUTTLE_GH="$SB/bin/gh"; export GIT_SHUTTLE_GH
}
