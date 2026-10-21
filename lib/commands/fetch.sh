# shellcheck shell=bash
# git shuttle fetch [--prune] [--all] — bring the remote's branches up to date; none of your branches changes

cmd_fetch() {
    local prune=0 all=0 args=()
    while (( $# )); do
        case "$1" in
            --prune) prune=1; shift ;;
            --all) all=1; shift ;;
            *) die "fetch: unknown argument '$1'" ;;
        esac
    done
    need_repo
    (( prune )) && args+=(--prune)
    if (( all )); then
        run git fetch --quiet "${args[@]}" --all || die "cannot fetch"
    else
        local remote; remote=$(cfg_remote)
        git remote get-url "$remote" >/dev/null 2>&1 || die "no remote named '$remote' (git config shuttle.remote <name>)"
        run git fetch --quiet "${args[@]}" "$remote" || die "cannot fetch from '$remote'"
    fi
    step "fetched"
}
