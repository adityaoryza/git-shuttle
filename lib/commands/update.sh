# shellcheck shell=bash
# git shuttle update [--check] [--to TAG] [--porcelain] — bring git-shuttle to the latest release
#
# It works on a copy that install.sh put in $PREFIX/share/git-shuttle. A git checkout, or a copy that somebody put somewhere by hand,
# is not touched: update it the way it came (git pull). The new release is downloaded next to the old one, checked (it must run and
# say the version that was asked for), and only then swapped in; if anything fails the old copy is still where it was.

UPDATE_DEFAULT_REPO=https://github.com/adityaoryza/git-shuttle

# update_repo — the repository address; GIT_SHUTTLE_REPO exists for tests and mirrors, and must be https (or this machine).
update_repo() {
    local repo=${GIT_SHUTTLE_REPO:-$UPDATE_DEFAULT_REPO}
    repo=${repo%/}
    case "$repo" in
        https://*|http://127.0.0.1:*|http://localhost:*) printf '%s' "$repo" ;;
        *) die "GIT_SHUTTLE_REPO must be an https address (it is '$repo')" ;;
    esac
}

# update_kind — installed (made by install.sh), checkout (a git work tree) or other.
update_kind() {
    if [[ -e "$ROOT/.git" ]]; then printf 'checkout'
    elif [[ "$(basename "$ROOT")" == git-shuttle && "$(basename "$(dirname "$ROOT")")" == share ]]; then printf 'installed'
    else printf 'other'
    fi
}

# update_newer A B — true when version B is newer than version A (leading "v" ignored).
update_newer() {
    local a=${1#v} b=${2#v}
    [[ "$a" != "$b" && "$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -n1)" == "$b" ]]
}

# update_latest_tag — the tag of the newest published release (the address /releases/latest answers with a redirect to it).
update_latest_tag() {
    local repo=$1 final tag
    command -v curl >/dev/null 2>&1 || die "curl is needed to look for a new release"
    final=$(curl -fsSL --connect-timeout 10 --max-time 30 -o /dev/null -w '%{url_effective}' "$repo/releases/latest" 2>/dev/null) \
        || die "cannot reach $repo: are you online?"
    tag=${final##*/}
    [[ "$final" == */releases/tag/* && "$tag" =~ ^v[0-9][0-9A-Za-z._-]*$ ]] || die "$repo has no published release yet: name a tag with --to"
    printf '%s' "$tag"
}

cmd_update() {
    local check=0 porcelain=0 to=""
    while (( $# )); do
        case "$1" in
            --check) check=1; shift ;;
            --porcelain) porcelain=1; shift ;;
            --to) [[ $# -ge 2 ]] || die "--to needs a tag, for example v0.1.2"; to=$2; shift 2 ;;
            *) die "update: unknown argument '$1'" ;;
        esac
    done
    [[ -z "$to" || "$to" =~ ^v[0-9][0-9A-Za-z._-]*$ ]] || die "'$to' is not a tag like v0.1.2"

    local repo kind tag current=$SHUTTLE_VERSION available=0 can=0 reason=""
    # a die inside $( ) only leaves the subshell: its status decides
    repo=$(update_repo) || exit "$EX_REFUSED"
    kind=$(update_kind)
    if [[ -n "$to" ]]; then tag=$to; else tag=$(update_latest_tag "$repo") || exit "$EX_REFUSED"; fi
    update_newer "$current" "$tag" && available=1
    case "$kind" in
        installed) can=1 ;;
        checkout) reason="this copy is a git checkout: update it with git pull" ;;
        *) reason="this copy was not installed by install.sh: install it again the same way" ;;
    esac
    if (( can )) && [[ ! -w "$(dirname "$ROOT")" ]]; then
        can=0; reason="no permission to write in $(dirname "$ROOT"): install it again with PREFIX set to a folder you own"
    fi

    if (( porcelain )); then
        printf 'current=%s\0latest=%s\0available=%s\0kind=%s\0can-update=%s\0reason=%s\0notes=%s\0' \
            "$current" "${tag#v}" "$available" "$kind" "$can" "$reason" "$repo/releases/tag/$tag"
        return 0
    fi

    if (( ! available )) && [[ -z "$to" ]]; then
        step "git-shuttle $current is the latest release"
        return 0
    fi
    if (( available )); then info "git-shuttle $current is installed; ${tag#v} is available ($repo/releases/tag/$tag)"
    else warn "$tag is not newer than the $current that is installed"; fi
    if (( check )); then
        (( can )) || info "$reason"
        return 0
    fi
    (( can )) || die "$reason"

    info "install:    $ROOT"
    info "download:   $repo/archive/refs/tags/$tag.tar.gz"
    confirm "Update git-shuttle $current -> ${tag#v}?"
    if (( DRY_RUN )); then
        info "(dry run) it would be downloaded next to $ROOT, checked, and swapped in"
        return 0
    fi
    update_install "$repo" "$tag"
    step "updated to ${tag#v}"
    info "What changed: $repo/releases/tag/$tag"
    info "If git shuttle ui is running, stop it (Ctrl-C) and start it again."
}

# update_install REPO TAG — download, check, swap; the old copy stays where it was unless everything went well.
update_install() {
    local repo=$1 tag=$2 stage old said
    stage="$ROOT.new.$$"
    old="$ROOT.old.$$"
    rm -rf "$stage"
    mkdir "$stage" || die "cannot make $stage"
    # shellcheck disable=SC2064  # the paths are fixed now
    trap "rm -rf '$stage'" EXIT
    info "downloading $tag"
    if ! curl -fsSL --connect-timeout 10 --max-time 180 --max-filesize 52428800 "$repo/archive/refs/tags/$tag.tar.gz" 2>/dev/null \
            | tar xz -C "$stage" --strip-components=1 2>/dev/null; then
        die "cannot download or unpack $tag (does the tag exist?): the installed copy was not touched"
    fi
    [[ -f "$stage/bin/git-shuttle" && -d "$stage/lib" ]] || die "the archive of $tag is not git-shuttle: the installed copy was not touched"
    chmod +x "$stage/bin/git-shuttle"
    said=$("$stage/bin/git-shuttle" --version 2>/dev/null) || die "the download of $tag does not run: the installed copy was not touched"
    [[ "$said" == "git-shuttle ${tag#v}" ]] || die "the download of $tag says '$said', not '${tag#v}': the installed copy was not touched"

    mv "$ROOT" "$old" || die "cannot move $ROOT (is git shuttle ui or another shell using it? close it and try again)"
    if ! mv "$stage" "$ROOT"; then
        mv "$old" "$ROOT"
        die "cannot put the new copy in place: the old one is back"
    fi
    if ! "$ROOT/bin/git-shuttle" --version >/dev/null 2>&1; then
        rm -rf "$ROOT"; mv "$old" "$ROOT"
        die "the new copy does not run: the old one is back"
    fi
    rm -rf "$old"
}
