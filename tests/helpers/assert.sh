# shellcheck shell=bash
# A tiny assertion library: every test file sources this, runs checks and ends with  finish

PASSED=0; FAILED=0

_ok()  { PASSED=$((PASSED + 1)); printf '  \033[32m✔\033[0m %s\n' "$1"; }
_bad() { FAILED=$((FAILED + 1)); printf '  \033[31m✘\033[0m %s\n' "$1"; shift; [[ $# -eq 0 ]] || printf '      %s\n' "$@"; }

assert_eq() { # expected actual message
    if [[ "$1" == "$2" ]]; then _ok "$3"; else _bad "$3" "expected: [$1]" "     got: [$2]"; fi
}
assert_contains() { # text needle message
    if [[ "$1" == *"$2"* ]]; then _ok "$3"; else _bad "$3" "expected to find: [$2]" "in: [${1:0:400}]"; fi
}
assert_not_contains() { # text needle message
    if [[ "$1" != *"$2"* ]]; then _ok "$3"; else _bad "$3" "did not expect: [$2]" "in: [${1:0:400}]"; fi
}
assert_status() { # expected-status actual-status message
    assert_eq "$1" "$2" "$3 (exit status)"
}

finish() {
    printf '  %d passed, %d failed\n' "$PASSED" "$FAILED"
    (( FAILED == 0 ))
}
