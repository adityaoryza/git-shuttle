# shellcheck shell=bash
# git shuttle upstream [BRANCH] --set REMOTE/BRANCH | --unset — what a branch pushes to and pulls from

cmd_upstream() {
    local branch="" set="" unset=0
    while (( $# )); do
        case "$1" in
            --set) [[ $# -ge 2 ]] || die "--set needs REMOTE/BRANCH"; set=$2; shift 2 ;;
            --unset) unset=1; shift ;;
            -*) die "upstream: unknown option '$1'" ;;
            *) [[ -z "$branch" ]] || die "upstream: give one branch"; branch=$1; shift ;;
        esac
    done
    need_repo
    if [[ -z "$branch" ]]; then need_branch; branch=$BRANCH; fi
    git show-ref -q --verify "refs/heads/$branch" || die "there is no local branch '$branch'"
    if [[ -z "$set" && $unset == 0 ]]; then
        local current; current=$(upstream_of "$branch")
        info "${branch}: ${current:-(no upstream)}"
        return 0
    fi
    (( ! (unset && ${#set}) )) || die "choose --set or --unset"
    if (( unset )); then
        [[ -n "$(upstream_of "$branch")" ]] || die "'$branch' has no upstream"
        confirm "Remove the upstream of '$branch'?"
        run git branch --unset-upstream "$branch" || die "cannot remove the upstream"
        step "'$branch' has no upstream"
        return 0
    fi
    have_ref "refs/remotes/$set" || die "'$set' is not a remote branch (fetch first, or check the name: remote/branch)"
    confirm "Make '$set' the upstream of '$branch'?"
    run git branch --set-upstream-to="$set" "$branch" || die "cannot set the upstream"
    step "'$branch' now follows $set"
}
