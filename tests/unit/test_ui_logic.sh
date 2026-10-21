#!/usr/bin/env bash
# The web UI's pure logic (ui/static/logic.js) and a smoke test of the page (every screen rendered on a minimal DOM), with node.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || { echo "  node is missing: skipped"; exit 0; }
rc=0
node "$here/../ui/test_logic.js" 2>&1 | tail -25 || rc=1
[[ ${PIPESTATUS[0]} -eq 0 ]] || rc=1
node "$here/../ui/test_page.js" 2>&1 | tail -10
[[ ${PIPESTATUS[0]} -eq 0 ]] || rc=1
exit "$rc"
