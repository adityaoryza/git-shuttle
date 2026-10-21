# shellcheck shell=bash
# git shuttle amend -m MESSAGE [--allow-pushed] — change the message of the last commit (nothing else about it changes)
#
# Only for a commit that is not on a remote (rewriting it would need a force push), not on a protected branch, and with a message
# that follows the repository's rules. What is staged is not added to the commit.

cmd_amend() {
    local message="" allow=0
    while (( $# )); do
        case "$1" in
            -m) [[ $# -ge 2 ]] || die "-m needs the message"; message=$2; shift 2 ;;
            --allow-pushed) allow=1; shift ;;
            *) die "amend: unknown argument '$1'" ;;
        esac
    done
    [[ -n "$message" ]] || die "amend needs the new message:  git shuttle amend -m \"[FIX] module: summary\""
    need_repo
    refuse_operation
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "amend"
    git rev-parse -q --verify HEAD >/dev/null || die "there is no commit to amend"
    local problem; problem=$(message_problem "$message")
    [[ -z "$problem" ]] || die "$problem"
    refuse_pushed "HEAD^!" "amending" "$allow"
    show_where "$branch"
    info "amend:      $(git log -1 --format='%h %s' HEAD)"
    info "new message: ${message%%$'\n'*}"
    confirm "Change the message?"
    run git commit --amend --only -m "$message" || die "cannot amend"
    step "the last commit now says: ${message%%$'\n'*}"
}
