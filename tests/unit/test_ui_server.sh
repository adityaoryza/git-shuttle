#!/usr/bin/env bash
# The web UI server: security and every action (python3 unittest, throw-away repositories, no network).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "  python3 is missing: skipped"; exit 0; }
out=$(python3 -W ignore "$here/../ui/test_server.py" 2>&1); rc=$?
passed=$(grep -c ' \.\.\. ok$' <<<"$out"); failed=$(grep -cE ' \.\.\. (FAIL|ERROR)$' <<<"$out")
printf '%s\n' "$out" | grep -E ' \.\.\. (ok|FAIL|ERROR)$' | sed -E 's/^(test_[a-z_0-9]+) \(.*\) \.\.\. ok$/  \x1b[32m✔\x1b[0m \1/; s/^(.*) \.\.\. (FAIL|ERROR)$/  \x1b[31m✘\x1b[0m \1/'
if (( rc != 0 )); then printf '%s\n' "$out" | tail -40; fi
printf '  %d passed, %d failed\n' "$passed" "$failed"
exit "$rc"
