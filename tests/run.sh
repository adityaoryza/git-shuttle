#!/usr/bin/env bash
# Runs every tests/unit/test_*.sh, each in its own process. No network, no real remote: each test builds its own repositories.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
failed=0
for file in "$here"/unit/test_*.sh; do
    printf '\n%s\n' "$(basename "$file")"
    bash "$file" || failed=$((failed + 1))
done
printf '\n'
if (( failed )); then printf '%d test file(s) failed\n' "$failed"; exit 1; fi
echo "all tests passed"
