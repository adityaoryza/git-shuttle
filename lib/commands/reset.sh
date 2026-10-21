# shellcheck shell=bash
# git shuttle reset --soft | --mixed | --hard COMMIT [--confirm-branch NAME] — move the branch you are on back (or elsewhere)
#
#   --soft   the branch moves; what the dropped commits changed stays staged
#   --mixed  the branch moves; those changes stay in the working tree, not staged
#   --hard   the branch moves and the working tree follows: changes are lost. Needs --confirm-branch with the name of the branch
#            (to be typed), and a clean working tree.
# Never when the commits that would be dropped are on a remote, and never on a protected branch.

cmd_reset() {
    local mode="" target="" confirm_name=""
    while (( $# )); do
        case "$1" in
            --soft|--mixed|--hard) [[ -z "$mode" ]] || die "reset: one of --soft, --mixed, --hard"; mode=${1#--}; shift ;;
            --confirm-branch) [[ $# -ge 2 ]] || die "--confirm-branch needs the branch name"; confirm_name=$2; shift 2 ;;
            -*) die "reset: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "reset: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$mode" && -n "$target" ]] || die "reset needs a mode and a commit:  git shuttle reset --soft <commit>"
    need_repo
    refuse_operation
    need_commit "$target"
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "reset"
    if [[ "$mode" == hard ]]; then
        require_clean_tree
        [[ "$confirm_name" == "$branch" ]] || die "a hard reset loses work: confirm it with  --confirm-branch $branch"
    fi
    [[ "$COMMIT" != "$(git rev-parse HEAD)" ]] || die "the branch is already there"
    local dropped; dropped=$(git rev-list --count "$COMMIT..HEAD")
    refuse_pushed "$COMMIT..HEAD" "reset --$mode"
    show_where "$branch"
    info "reset:      '$branch' to $(git log -1 --format='%h %s' "$COMMIT") (--$mode)"
    (( dropped == 0 )) || info "drops:      $dropped commit(s) from the branch (they stay reachable from the reflog for a while)"
    confirm "Reset '$branch'?"
    run git reset -q "--$mode" "$COMMIT" || die "cannot reset"
    step "'$branch' is at $(git rev-parse --short "$COMMIT")"
}
