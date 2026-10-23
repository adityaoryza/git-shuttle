# shellcheck shell=bash
# git shuttle push [--force-with-lease] — push the current feature branch

# push_branch BRANCH [force] — push, setting the upstream the first time. A rejected push is never forced by itself.
push_branch() {
    local branch=$1 force=${2:-0} remote args=()
    remote=$(cfg_remote)
    git remote get-url "$remote" >/dev/null 2>&1 || die "no remote named '$remote' (git config shuttle.remote <name>)"
    [[ -n "$(upstream_of "$branch")" ]] || args+=(-u)
    (( force )) && args+=(--force-with-lease)
    run git push "${args[@]}" "$remote" "$branch" || stop "the push of '$branch' was rejected.
  If the remote has new commits:   git shuttle sync
  If you rewrote the branch:       git shuttle push --force-with-lease"
    trace_event push "$branch" "sha=$(trace_sha "$branch")" "remote=$remote"
}

cmd_push() {
    local force=0 allow_protected=0
    while (( $# )); do
        case "$1" in
            --force-with-lease) force=1; shift ;;
            --allow-protected) allow_protected=1; shift ;;
            *) die "push: unknown argument '$1'" ;;
        esac
    done
    need_repo
    local branch
    need_branch; branch=$BRANCH
    (( allow_protected )) || refuse_protected "$branch" "push"
    show_where "$branch"
    confirm "Push $branch to $(cfg_remote)?"
    push_branch "$branch" "$force"
}
