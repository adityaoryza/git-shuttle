#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# git shuttle update, against a stand-in for the release pages of GitHub (tests/helpers/fake_github.py): no network.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
T=$(mktemp -d "${TMPDIR:-/tmp}/shuttle-update.XXXXXX")
PIDS=()
cleanup() { local pid; for pid in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$pid" 2>/dev/null; done; chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
CURRENT=$(sed -n 's/^readonly SHUTTLE_VERSION="\(.*\)"/\1/p' "$SRC/lib/core/output.sh")

# fake VERSION [MODE] — a release page that says VERSION is the latest; GIT_SHUTTLE_REPO points at it.
fake() {
    local port_file="$T/port.$RANDOM" port
    python3 "$SRC/tests/helpers/fake_github.py" "$port_file" "$1" "${2:-ok}" &
    PIDS+=($!)
    for _ in {1..50}; do [[ -s "$port_file" ]] && break; sleep 0.1; done
    port=$(cat "$port_file")
    export GIT_SHUTTLE_REPO="http://127.0.0.1:$port/acme/git-shuttle"
}
# a copy the way install.sh makes it: $PREFIX/share/git-shuttle, without .git
install_copy() {
    rm -rf "$T/prefix"; mkdir -p "$T/prefix/share/git-shuttle" "$T/prefix/bin"
    cp -r "$SRC/bin" "$SRC/lib" "$T/prefix/share/git-shuttle/"
    INST="$T/prefix/share/git-shuttle/bin/git-shuttle"
}
inst() { "$INST" "$@" >"$T/out" 2>&1; RC=$?; OUT=$(tr '\0' '\n' <"$T/out"); }
leftovers() { find "$T/prefix/share" -maxdepth 1 -name 'git-shuttle.*' | wc -l | tr -d ' '; }
installed_version() { "$INST" --version; }

# --- looking, from a checkout -------------------------------------------------------------------------------------------------
fake 9.9.9
shuttle update --check
assert_status 0 "$RC" "update --check"
assert_contains "$OUT" "$CURRENT is installed; 9.9.9 is available" "...says what is installed and what is available"
assert_contains "$OUT" "git checkout" "...and that a checkout is updated with git pull"
shuttle -y update
assert_status 1 "$RC" "update on a git checkout"
assert_contains "$OUT" "git pull" "...is refused, with the way to update it"
shuttle update --check --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "available=1" "porcelain: an update is available"
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "kind=checkout" "...of a checkout"
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "can-update=0" "...that cannot be updated here"

# --- an installed copy ----------------------------------------------------------------------------------------------------------
install_copy
inst update --check
assert_status 0 "$RC" "update --check on an installed copy"
assert_contains "$OUT" "9.9.9 is available" "...sees the new release"
assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...and changes nothing"
inst update --check --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "can-update=1" "porcelain: it can be updated"
assert_contains "$(tr '\0' '\n' <<<"$OUT")" "latest=9.9.9" "...to 9.9.9"
inst -n update
assert_status 0 "$RC" "update --dry-run"
assert_contains "$OUT" "dry run" "...says it is one"
assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...and changes nothing"
with_tty "n" "$INST" update
assert_status 3 "$RC" "declining the question"
assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...changes nothing"
inst update
assert_status 1 "$RC" "update without a terminal and without --yes"
assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...changes nothing"

inst -y update
assert_status 0 "$RC" "update"
assert_eq "git-shuttle 9.9.9" "$(installed_version)" "...the copy is the new release"
assert_eq "new" "$(cat "$T/prefix/share/git-shuttle/lib/core/marker")" "...with its files"
assert_eq "0" "$(leftovers)" "...and no leftover of the swap"
assert_contains "$OUT" "stop it (Ctrl-C)" "...it says that a running web page has to be restarted"
install_copy; fake "$CURRENT"
inst -y update
assert_status 0 "$RC" "update when this is the latest release"
assert_contains "$OUT" "is the latest release" "...it is up to date"

# --- what goes wrong leaves the old copy where it was -----------------------------------------------------------------------------
for mode in wrong-version corrupt missing not-git-shuttle; do
    install_copy; fake 9.9.9 "$mode"
    inst -y update
    assert_status 1 "$RC" "update with a release that is $mode"
    assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...the old copy is still there and runs"
    assert_eq "0" "$(leftovers)" "...and nothing is left of the attempt"
done
install_copy; fake 9.9.9 no-release
inst -y update
assert_status 1 "$RC" "a repository without a published release"
assert_contains "$OUT" "--to" "...says to name a tag"

install_copy
GIT_SHUTTLE_REPO="http://127.0.0.1:9/acme/git-shuttle" inst -y update
assert_status 1 "$RC" "no connection"
assert_contains "$OUT" "cannot reach" "...says so"
GIT_SHUTTLE_REPO="http://example.com/acme/git-shuttle" inst -y update
assert_status 1 "$RC" "a repository address that is not https"
assert_contains "$OUT" "https" "...is refused"

# --- naming a tag -------------------------------------------------------------------------------------------------------------------
install_copy; fake 9.9.9
inst -y update --to v1.2.3
assert_status 0 "$RC" "update --to a tag"
assert_eq "git-shuttle 1.2.3" "$(installed_version)" "...installs that one"
install_copy
inst update --to latest
assert_status 1 "$RC" "a tag that is not a version"
inst update --to
assert_status 1 "$RC" "--to without a tag"
inst -y update --to v0.0.1
assert_status 0 "$RC" "an older tag is allowed when it is asked for"
assert_contains "$OUT" "not newer" "...with a warning"
install_copy
inst update --frob
assert_status 1 "$RC" "an unknown argument"

# --- a folder that cannot be written ----------------------------------------------------------------------------------------------
if [[ "$(id -u)" != 0 ]]; then
    install_copy; fake 9.9.9
    chmod a-w "$T/prefix/share"
    inst -y update
    assert_status 1 "$RC" "update where the folder cannot be written"
    assert_contains "$OUT" "no permission" "...says so"
    assert_eq "git-shuttle $CURRENT" "$(installed_version)" "...and the copy still runs"
    chmod u+w "$T/prefix/share"
fi

# --- a copy put somewhere by hand ---------------------------------------------------------------------------------------------------
rm -rf "$T/hand"; mkdir -p "$T/hand/tool"; cp -r "$SRC/bin" "$SRC/lib" "$T/hand/tool/"
INST="$T/hand/tool/bin/git-shuttle"
fake 9.9.9
inst -y update
assert_status 1 "$RC" "a copy that was not installed by install.sh"
assert_contains "$OUT" "install it again" "...is not touched, and the way is told"

finish
