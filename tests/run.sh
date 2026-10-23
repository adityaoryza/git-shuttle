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
export GIT_SHUTTLE_NO_UPDATE_CHECK=1       # a command looks for a newer release by itself (update_remind): not in a test, unless it is about that

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
    local out rc file passed=0 failed_tests=0
    for file in test_server.py test_deploy.py test_vault.py test_addons.py test_ops.py test_log.py test_brand.py test_cli.py; do
        out=$(python3 -W ignore "$here/ui/$file" 2>&1); rc=$?
        printf '%s\n' "$out" | grep -E ' \.\.\. (ok|FAIL|ERROR)$' | sed -E 's/^(test_[a-z_0-9]+) \(.*\) \.\.\. ok$/  \x1b[32m✔\x1b[0m \1/; s/^(.*) \.\.\. (FAIL|ERROR)$/  \x1b[31m✘\x1b[0m \1/'
        (( rc == 0 )) || { printf '%s\n' "$out" | tail -40; failed=$((failed + 1)); }
        passed=$((passed + $(grep -c ' \.\.\. ok$' <<<"$out")))
        failed_tests=$((failed_tests + $(grep -cE ' \.\.\. (FAIL|ERROR)$' <<<"$out")))
    done
    printf '  %d passed, %d failed\n' "$passed" "$failed_tests"
}

run_front() {
    printf '\n%s\n' "ui/front (node)"
    if ! command -v node >/dev/null 2>&1; then echo "  node is missing: skipped"; return; fi
    local file
    for file in "$here"/ui/test_*.mjs; do
        node "$file" 2>&1 | tail -25
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
