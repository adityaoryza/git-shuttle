#!/usr/bin/env bash
# Installs git-shuttle from a release of https://github.com/adityaoryza/git-shuttle
#
#   curl -fsSL https://github.com/adityaoryza/git-shuttle/raw/main/install.sh | bash
#
# Options, as environment variables:
#   GIT_SHUTTLE_VERSION   a tag such as v0.1.1 (default: the latest release; a pre-release must be named)
#   PREFIX                where to install (default: ~/.local): the program goes to $PREFIX/share/git-shuttle,
#                         and git-shuttle is linked into $PREFIX/bin, so that `git shuttle` works
set -euo pipefail

REPO=https://github.com/adityaoryza/git-shuttle
PREFIX=${PREFIX:-$HOME/.local}
version=${GIT_SHUTTLE_VERSION:-latest}

say() { printf 'git-shuttle: %s\n' "$*"; }
die() { printf 'git-shuttle: %s\n' "$*" >&2; exit 1; }

for tool in curl tar git; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is needed and was not found"
done
(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) \
    || die "git-shuttle needs bash 4.4 or newer (this is $BASH_VERSION); on macOS: brew install bash"
command -v python3 >/dev/null 2>&1 || say "python3 was not found: the commands work, the web page (git shuttle ui) needs Python 3.9 or newer"

if [[ "$version" == latest ]]; then
    # the address "releases/latest" answers with a redirect to the tag of the newest release
    final=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$REPO/releases/latest") || die "cannot reach $REPO"
    version=${final##*/}
    [[ "$version" == v* ]] || die "there is no published release yet: name a tag, e.g. GIT_SHUTTLE_VERSION=v0.1.1"
fi
[[ "$version" =~ ^v[0-9][0-9A-Za-z._-]*$ ]] || die "'$version' is not a tag like v0.1.1"

share="$PREFIX/share/git-shuttle"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/git-shuttle-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

say "downloading $version"
mkdir "$tmp/src"
curl -fsSL "$REPO/archive/refs/tags/$version.tar.gz" | tar xz -C "$tmp/src" --strip-components=1 \
    || die "cannot download or unpack $version (does the tag exist?)"
[[ -x "$tmp/src/bin/git-shuttle" || -f "$tmp/src/bin/git-shuttle" ]] || die "the archive has no bin/git-shuttle"

mkdir -p "$PREFIX/share" "$PREFIX/bin"
# the add-ons that were installed live in the program folder (addons/): they go into the new copy as they were, so that an add-on that was enabled stays enabled
if [[ -d "$share/addons" ]]; then
    rm -rf "$tmp/src/addons"
    mv "$share/addons" "$tmp/src/addons" || die "cannot keep the add-ons that are installed in $share/addons: nothing was changed"
fi
rm -rf "$share"
mv "$tmp/src" "$share"
chmod +x "$share/bin/git-shuttle"
# a small launcher instead of a link: it works where links do not (git-shuttle finds lib/ next to the file that is run)
rm -f "$PREFIX/bin/git-shuttle"
printf '#!/bin/sh\nexec "%s/bin/git-shuttle" "$@"\n' "$share" > "$PREFIX/bin/git-shuttle"
chmod +x "$PREFIX/bin/git-shuttle"

say "installed $("$PREFIX/bin/git-shuttle" --version) in $share"
say "launcher: $PREFIX/bin/git-shuttle"
case ":$PATH:" in
    *":$PREFIX/bin:"*) say "try it:  git shuttle --help" ;;
    *) say "add $PREFIX/bin to your PATH, for example:  export PATH=\"$PREFIX/bin:\$PATH\"" ;;
esac
