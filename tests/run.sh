#!/usr/bin/env bash
# Runs every test suite. Each test builds its own throw-away repositories: no network, no real remote.
#
#   tests/run.sh            all suites
#   tests/run.sh cli        the command tests (bash)
#   tests/run.sh server     the web UI server: security and every action (python3)
#   tests/run.sh front      the web UI page: pure logic and graph layout (node)
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
suite=${1:-all}
failed=0

run_cli() {
    local file
    for file in "$here"/cli/test_*.sh; do
        printf '\n%s\n' "cli/$(basename "$file")"
        bash "$file" || failed=$((failed + 1))
    done
}

run_server() {
    printf '\n%s\n' "ui/server (python3)"
    if ! command -v python3 >/dev/null 2>&1; then echo "  python3 is missing: skipped"; return; fi
    local out rc
    out=$(python3 -W ignore "$here/ui/test_server.py" 2>&1); rc=$?
    printf '%s\n' "$out" | grep -E ' \.\.\. (ok|FAIL|ERROR)$' | sed -E 's/^(test_[a-z_0-9]+) \(.*\) \.\.\. ok$/  \x1b[32m✔\x1b[0m \1/; s/^(.*) \.\.\. (FAIL|ERROR)$/  \x1b[31m✘\x1b[0m \1/'
    (( rc == 0 )) || { printf '%s\n' "$out" | tail -40; failed=$((failed + 1)); }
    printf '  %d passed, %d failed\n' "$(grep -c ' \.\.\. ok$' <<<"$out")" "$(grep -cE ' \.\.\. (FAIL|ERROR)$' <<<"$out")"
}

run_front() {
    printf '\n%s\n' "ui/front (node)"
    if ! command -v node >/dev/null 2>&1; then echo "  node is missing: skipped"; return; fi
    local file
    for file in test_logic.mjs test_graph.mjs test_diff.mjs test_theme.mjs test_version.mjs; do
        node "$here/ui/$file" 2>&1 | tail -25
        [[ ${PIPESTATUS[0]} -eq 0 ]] || failed=$((failed + 1))
    done
}

case "$suite" in
    all)    run_cli; run_server; run_front ;;
    cli)    run_cli ;;
    server) run_server ;;
    front)  run_front ;;
    *) echo "usage: tests/run.sh [all|cli|server|front]" >&2; exit 2 ;;
esac
printf '\n'
if (( failed )); then printf '%d suite(s) failed\n' "$failed"; exit 1; fi
echo "all tests passed"
