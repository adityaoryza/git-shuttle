# shellcheck shell=bash
# git shuttle addon available [--porcelain] | install NAME [--version TAG] | uninstall NAME
#
# Getting an add-on from the list that git-shuttle ships (lib/addons/registry.json: a name, and the GitHub repository and the file of its releases).
# Only what is in that list can be installed, and only from the release of that repository, over https:
#   - the archive is downloaded with its SHA256SUMS and the checksum has to match: nothing is installed otherwise;
#   - it is unpacked, never run: no script of the archive is executed, an archive with links or with paths that go out of its folder is refused;
#   - it goes to ~/.local/share/git-shuttle/addons/NAME/TAG (the version before stays), and git-shuttle-NAME is linked in addons/bin, which is
#     searched for add-ons as well as the PATH. It is still not enabled: enabling shows what it asks for, and pins the program.
# The list says who is trusted: the owner of the repository. A checksum from the same release proves the download is whole, not who wrote it.

addon_home() { printf '%s' "${GIT_SHUTTLE_ADDON_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/git-shuttle/addons}"; }

# addon_base — where the releases are (GitHub); GIT_SHUTTLE_ADDON_BASE is for tests and mirrors: https, or this machine.
addon_base() {
    local base=${GIT_SHUTTLE_ADDON_BASE:-https://github.com}
    base=${base%/}
    case "$base" in
        https://*|http://127.0.0.1:*|http://localhost:*) printf '%s' "$base" ;;
        *) die "GIT_SHUTTLE_ADDON_BASE must be an https address (it is '$base')" ;;
    esac
}

addon_registry_file() { printf '%s' "${GIT_SHUTTLE_ADDON_REGISTRY:-$ROOT/lib/addons/registry.json}"; }

# addon_registry — the entries of the list, checked: NUL separated "entry=name US title US description US repo US asset US program".
addon_registry() {
    addon_need_python
    addon_proto registry "$(addon_registry_file)" || die "the list of add-ons is not valid ($(addon_registry_file))"
}

# shellcheck disable=SC2034  # ENTRY_DESC is read by callers that show it
# addon_load_entry NAME — sets ENTRY_TITLE, ENTRY_DESC, ENTRY_REPO, ENTRY_ASSET and ENTRY_PROGRAM; returns 1 when the name is not in the list.
addon_load_entry() {
    local rec fields found=1
    addon_registry >/dev/null       # a list that is not valid stops here, saying so (a failure inside the loop below would not be seen)
    while IFS= read -r -d '' rec; do
        IFS=$'\x1f' read -r -a fields <<<"${rec#entry=}"
        if [[ "${fields[0]}" == "$1" ]]; then
            ENTRY_TITLE=${fields[1]}; ENTRY_DESC=${fields[2]}; ENTRY_REPO=${fields[3]}; ENTRY_ASSET=${fields[4]}; ENTRY_PROGRAM=${fields[5]}
            found=0
        fi
    done < <(addon_registry)
    return "$found"
}

# addon_installed_version NAME — the tag that is installed (empty: none).
addon_installed_version() {
    local link; link="$(addon_home)/$1/current"
    [[ -L "$link" ]] && basename "$(readlink "$link")"
    return 0
}

addon_available() {
    local porcelain=${1:-0} rec fields name state version
    addon_registry >/dev/null
    while IFS= read -r -d '' rec; do
        IFS=$'\x1f' read -r -a fields <<<"${rec#entry=}"
        name=${fields[0]}; state=$(addon_state "$name"); version=$(addon_installed_version "$name")
        if (( porcelain )); then
            printf 'available=%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\0' "$name" "${fields[1]}" "${fields[2]}" "${fields[3]}" "$version" "$state" "$(addon_find "$name")"
        else
            printf '%-14s %-10s %-9s %s\n' "$name" "$state" "${version:--}" "${fields[1]}: ${fields[2]}"
        fi
    done < <(addon_registry)
    return 0
}

# addon_install NAME [TAG] — see the top of this file.
addon_install() {
    local name=$1 tag=${2:-} home base repo_url asset url sums tmp stage dest want got
    addon_load_entry "$name" || die "'$name' is not in the list of add-ons that git-shuttle knows (git shuttle addon available)"
    command -v curl >/dev/null 2>&1 || die "curl is needed to download an add-on"
    command -v tar >/dev/null 2>&1 || die "tar is needed to unpack an add-on"
    home=$(addon_home)
    base=$(addon_base) || exit "$EX_REFUSED"
    repo_url="$base/$ENTRY_REPO"
    if [[ -z "$tag" ]]; then tag=$(update_latest_tag "$repo_url") || exit "$EX_REFUSED"; fi
    [[ "$tag" =~ ^v[0-9][0-9A-Za-z._-]*$ ]] || die "'$tag' is not a tag like v0.2.0"
    asset=${ENTRY_ASSET//\{tag\}/$tag}
    url="$repo_url/releases/download/$tag/$asset"
    sums="$repo_url/releases/download/$tag/SHA256SUMS"
    info "add-on:      $name $tag  ($ENTRY_TITLE)"
    info "from:        $url"
    info "checked by:  $sums"
    info "into:        $home/$name/$tag"
    info "it is unpacked and linked, not run; it is not enabled until you enable it"
    confirm "Install the add-on '$name' $tag?"
    if (( DRY_RUN )); then info "(dry run) nothing was downloaded"; return 0; fi

    tmp=$(mktemp -d)
    stage="$home/.stage.$$"
    # shellcheck disable=SC2064  # the paths are fixed now
    trap "rm -rf '$tmp' '$stage'" EXIT
    info "downloading $asset"
    curl -fsSL --connect-timeout 10 --max-time 180 --max-filesize 52428800 -o "$tmp/$asset" "$url" 2>/dev/null \
        || die "cannot download $url (is there such a release? are you online?): nothing was installed"
    curl -fsSL --connect-timeout 10 --max-time 30 --max-filesize 1048576 -o "$tmp/SHA256SUMS" "$sums" 2>/dev/null \
        || die "cannot download $sums: without it the archive cannot be checked, so nothing was installed"
    want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print tolower($1); exit }' "$tmp/SHA256SUMS")
    [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS has no checksum for $asset: nothing was installed"
    got=$(addon_sha "$tmp/$asset")
    [[ "$got" == "$want" ]] || die "CHECKSUM MISMATCH for $asset (expected $want, got $got): nothing was installed"
    step "the checksum matches"
    # what is in the archive: no link (it could point out of the folder), no path that leaves it
    if tar -tvzf "$tmp/$asset" 2>/dev/null | awk '$1 ~ /^[lh]/ { bad = 1 } END { exit !bad }'; then die "the archive has links: it is refused, nothing was installed"; fi
    if tar -tzf "$tmp/$asset" 2>/dev/null | grep -Eq '(^|/)\.\.(/|$)|^/'; then die "the archive has paths that leave its folder: it is refused, nothing was installed"; fi
    rm -rf "$stage"; mkdir -p "$stage" "$home/bin"
    tar -xzf "$tmp/$asset" -C "$stage" --strip-components=1 --no-same-owner 2>/dev/null || die "cannot unpack $asset: nothing was installed"
    [[ -f "$stage/$ENTRY_PROGRAM" ]] || die "the archive has no $ENTRY_PROGRAM: it is not the add-on '$name', nothing was installed"
    chmod +x "$stage/$ENTRY_PROGRAM"
    mkdir -p "$home/$name"
    dest="$home/$name/$tag"
    rm -rf "$dest"
    mv "$stage" "$dest" || die "cannot put it in place at $dest"
    ln -sfn "$tag" "$home/$name/current"
    ln -sfn "$home/$name/current/$ENTRY_PROGRAM" "$home/bin/git-shuttle-$name"
    step "add-on '$name' $tag installed in $dest"
    info "to use it:  git shuttle addon enable $name   (it shows what the add-on asks for, and pins the program)"
}

addon_uninstall() {
    local name=$1 home
    addon_valid_name "$name" || die "'$name' is not an add-on name"
    home=$(addon_home)
    [[ -d "$home/$name" || -L "$home/bin/git-shuttle-$name" ]] || die "the add-on '$name' was not installed by git-shuttle (a program of your own on the PATH is yours to remove)"
    confirm "Remove the add-on '$name' (its files in $home/$name)?"
    run rm -rf "${home:?}/$name" "$home/bin/git-shuttle-$name" || die "cannot remove it"
    if [[ "$(addon_cfg "$name" enabled)" == true ]]; then
        warn "its settings are still saved for this repository: git shuttle addon disable $name"
    fi
    step "add-on '$name' removed"
}
