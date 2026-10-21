# shellcheck shell=bash
# git shuttle delete BRANCH [--force] | delete --remote BRANCH — delete a local branch, or a branch on the remote
#
# A local branch is deleted with git's own check that its commits are merged somewhere; --force deletes it anyway, and says how
# many commits would then be reachable only from the reflog. Never the branch you are on, never a protected branch.

cmd_delete() {
    local name="" force=0 remote_only=0
    while (( $# )); do
        case "$1" in
            --force) force=1; shift ;;
            --remote) remote_only=1; shift ;;
            -*) die "delete: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "delete: give one branch"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "delete needs a branch:  git shuttle delete feature/old"
    need_repo
    valid_branch_name "$name" || die "'$name' is not a valid branch name"
    is_protected "$name" && die "'$name' is a protected branch: it is not deleted"
    local remote; remote=$(cfg_remote)
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    if (( remote_only )); then
        git show-ref -q --verify "refs/remotes/$remote/$name" || die "there is no branch '$name' on '$remote' (fetch first?)"
        info "delete:     $remote/$name on the remote"
        confirm "Delete '$name' on $remote? Others who have it keep their copy."
        run git push "$remote" --delete "$name" || die "the remote refused"
        step "deleted $remote/$name"
        return 0
    fi
    git show-ref -q --verify "refs/heads/$name" || die "there is no local branch '$name'"
    [[ "$(git symbolic-ref -q --short HEAD || true)" != "$name" ]] || die "'$name' is the branch you are on: switch to another first"
    local elsewhere; elsewhere=$(branch_worktree "$name")
    [[ -z "$elsewhere" ]] || die "'$name' is checked out in another worktree ($elsewhere)"
    local lost
    lost=$(git rev-list --count "$name" --not --exclude="$name" --branches --remotes --tags)
    info "delete:     local branch $name ($(git rev-parse --short "$name"))"
    if (( lost > 0 )); then
        if (( force )); then warn "$lost commit(s) are on no other branch, remote or tag: they would only be reachable from the reflog"
        else info "it has $lost commit(s) that are on no other branch: git will refuse unless you use --force"; fi
    fi
    confirm "Delete '$name'?"
    if (( force )); then run git branch -D "$name" || die "cannot delete"
    else run git branch -d "$name" || die "'$name' is not fully merged: use --force to delete it anyway ($lost commit(s) would be lost)"; fi
    step "deleted $name"
}
