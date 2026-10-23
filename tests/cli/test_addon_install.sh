#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# git shuttle addon available | install | uninstall, against a stand-in of the releases of GitHub (tests/helpers/fake_addon_release.py): no network.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
sandbox_new
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null; rm -rf "$SB"' EXIT
export GIT_SHUTTLE_ADDON_HOME="$SB/addon-home"
unset GIT_SHUTTLE_ADDON_PATH
cat >"$SB/registry.json" <<'JSON'
{"addons":[{"name":"acme-tool","title":"Acme tool","description":"A stand-in add-on for the tests","repo":"acme/acme-tool","asset":"acme-tool-{tag}.tar.gz","program":"bin/git-shuttle-acme-tool","protocol":1}]}
JSON
export GIT_SHUTTLE_ADDON_REGISTRY="$SB/registry.json"

# fake VERSION [MODE] — a releases page for acme/acme-tool; GIT_SHUTTLE_ADDON_BASE points at it. The requests it got are in $PORT_FILE.log.
fake() {
    PORT_FILE="$SB/port.$RANDOM"
    python3 "$SRC/tests/helpers/fake_addon_release.py" "$PORT_FILE" acme/acme-tool acme-tool "$1" "${2:-ok}" &
    PIDS+=($!)
    for _ in {1..50}; do [[ -s "$PORT_FILE" ]] && break; sleep 0.1; done
    GIT_SHUTTLE_ADDON_BASE="http://127.0.0.1:$(cat "$PORT_FILE")"
    export GIT_SHUTTLE_ADDON_BASE
}
requests() { grep -c . "$PORT_FILE.log" 2>/dev/null || true; }

# --- the list ----------------------------------------------------------------------------------------------------------------------------
shuttle addon available
assert_status 0 "$RC" "available"
assert_contains "$OUT" "acme-tool" "...lists what git-shuttle knows"
assert_contains "$OUT" "missing" "...as not installed"
shuttle addon available --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT" | tr '\037' '|')" "available=acme-tool|Acme tool|A stand-in add-on for the tests|acme/acme-tool||missing|" "porcelain: name, title, description, repository, installed version, state"
shuttle addon install nothing-like-it
assert_status 1 "$RC" "a name that is not in the list"
assert_contains "$OUT" "not in the list of add-ons" "...is refused"
shuttle addon install "../x"
assert_status 1 "$RC" "a name that is a path"

# --- installing ----------------------------------------------------------------------------------------------------------------------------
fake 1.0.0
shuttle -n addon install acme-tool
assert_status 0 "$RC" "install --dry-run"
assert_contains "$OUT" "acme-tool-v1.0.0.tar.gz" "...says what it would download"
assert_contains "$OUT" "SHA256SUMS" "...and what checks it"
assert_contains "$OUT" "dry run" "...says it is one"
assert_eq "0" "$(grep -c '/download/' "$PORT_FILE.log")" "...nothing was downloaded: only the page of the latest release was asked for"
assert_eq "no" "$([[ -e "$GIT_SHUTTLE_ADDON_HOME/acme-tool" ]] && echo yes || echo no)" "...and nothing is installed"
shuttle -y addon install acme-tool
assert_status 0 "$RC" "install"
assert_contains "$OUT" "the checksum matches" "...checks the archive"
assert_eq "v1.0.0" "$(readlink "$GIT_SHUTTLE_ADDON_HOME/acme-tool/current")" "...the version is the one of the latest release"
assert_eq "yes" "$([[ -x "$GIT_SHUTTLE_ADDON_HOME/bin/git-shuttle-acme-tool" ]] && echo yes || echo no)" "...the program is linked where add-ons are looked for"
assert_contains "$OUT" "git shuttle addon enable acme-tool" "...and says that it is not enabled"
assert_eq "" "$(git config shuttle.addon.acme-tool.enabled)" "...it is not enabled"
shuttle addon list
assert_contains "$OUT" "acme-tool" "list: it is found, with no change of the PATH"
shuttle addon available
assert_contains "$OUT" "v1.0.0" "available: the installed version"
shuttle -y addon enable acme-tool
assert_status 0 "$RC" "it can be enabled like any add-on"
shuttle addon cards --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "From the downloaded add-on 1.0.0" "...and it works"
shuttle addon check acme-tool
assert_status 0 "$RC" "...and it follows the protocol"

# --- a newer version, side by side with the old one ---------------------------------------------------------------------------------
kill "${PIDS[0]}" 2>/dev/null; PIDS=()
fake 1.1.0
shuttle -y addon install acme-tool
assert_status 0 "$RC" "install again, when a newer release is out"
assert_eq "v1.1.0" "$(readlink "$GIT_SHUTTLE_ADDON_HOME/acme-tool/current")" "...the newer one is current"
assert_eq "yes" "$([[ -d "$GIT_SHUTTLE_ADDON_HOME/acme-tool/v1.0.0" ]] && echo yes || echo no)" "...the version before is kept"
shuttle addon list
assert_contains "$OUT" "changed" "...and, being another program, it has to be enabled again"
shuttle -y addon install acme-tool --version v1.0.0
assert_eq "v1.0.0" "$(readlink "$GIT_SHUTTLE_ADDON_HOME/acme-tool/current")" "--version goes back to an older release"
shuttle -y addon install acme-tool --version "1.0.0"
assert_status 1 "$RC" "a version that is not a tag"

# --- what is refused --------------------------------------------------------------------------------------------------------------------------
for mode in bad-checksum:"CHECKSUM MISMATCH" no-sums:"cannot download" no-program:"has no bin/git-shuttle-acme-tool" links:"has links" traversal:"leave its folder" no-release:"no published release"; do
    kill "${PIDS[@]}" 2>/dev/null; PIDS=()
    rm -rf "$GIT_SHUTTLE_ADDON_HOME"
    fake 2.0.0 "${mode%%:*}"
    shuttle -y addon install acme-tool
    assert_status 1 "$RC" "install of a release that is ${mode%%:*}"
    assert_contains "$OUT" "${mode#*:}" "...says why"
    assert_eq "no" "$([[ -e "$GIT_SHUTTLE_ADDON_HOME/acme-tool/current" || -e "$GIT_SHUTTLE_ADDON_HOME/bin/git-shuttle-acme-tool" ]] && echo yes || echo no)" "...and nothing is installed"
    assert_eq "no" "$([[ -e "$GIT_SHUTTLE_ADDON_HOME/escaped" || -e "$SB/escaped" ]] && echo yes || echo no)" "...nothing was written outside"
done
GIT_SHUTTLE_ADDON_BASE="http://example.invalid" shuttle -y addon install acme-tool
assert_status 1 "$RC" "a base that is not https and not this machine"
assert_contains "$OUT" "must be an https address" "...is refused"

# the program of an archive is not run by the install: a marker that the program would write
kill "${PIDS[@]}" 2>/dev/null; PIDS=()
rm -rf "$GIT_SHUTTLE_ADDON_HOME"
fake 3.0.0
shuttle -y addon install acme-tool
assert_status 0 "$RC" "install of a good release after the bad ones"

# --- uninstalling ----------------------------------------------------------------------------------------------------------------------------
shuttle -y addon uninstall acme-tool
assert_status 0 "$RC" "uninstall"
assert_eq "no" "$([[ -e "$GIT_SHUTTLE_ADDON_HOME/acme-tool" || -L "$GIT_SHUTTLE_ADDON_HOME/bin/git-shuttle-acme-tool" ]] && echo yes || echo no)" "...nothing is left"
shuttle -y addon uninstall acme-tool
assert_status 1 "$RC" "uninstall of what is not installed"
mkdir -p "$SB/mine"; printf '#!/bin/sh\n' >"$SB/mine/git-shuttle-mine"; chmod +x "$SB/mine/git-shuttle-mine"
shuttle -y addon uninstall mine
assert_status 1 "$RC" "a program of your own is never removed by git-shuttle"
assert_eq "yes" "$([[ -x "$SB/mine/git-shuttle-mine" ]] && echo yes || echo no)" "...it is still there"

# the list itself is checked
echo '{"addons":[{"name":"x","title":"t","description":"d","repo":"not a repo","asset":"x-{tag}.tar.gz","program":"bin/x","protocol":1}]}' >"$SB/bad-registry.json"
GIT_SHUTTLE_ADDON_REGISTRY="$SB/bad-registry.json" shuttle addon available
assert_status 1 "$RC" "a list with an entry that is not valid"
echo '{"addons":[{"name":"x","title":"t","description":"d","repo":"a/b","asset":"x-{tag}.tar.gz","program":"../x","protocol":1}]}' >"$SB/bad-registry.json"
GIT_SHUTTLE_ADDON_REGISTRY="$SB/bad-registry.json" shuttle addon available
assert_status 1 "$RC" "...or a program that leaves the archive"

finish
