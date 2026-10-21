# shellcheck shell=bash
# git shuttle rename OLD NEW [--remote] — rename a local branch
#
# --remote also renames it on the remote: the new name is pushed, the old one deleted there, and the upstream updated.
# Not for a protected branch, a name that is taken, or a branch that another worktree has checked out.

cmd_rename() {
    local old="" new="" remote_too=0
    while (( $# )); do
        case "$1" in
            --remote) remote_too=1; shift ;;
            -*) die "rename: unknown option '$1'" ;;
            *) if [[ -z "$old" ]]; then old=$1; elif [[ -z "$new" ]]; then new=$1; else die "rename: give the old and the new name"; fi; shift ;;
        esac
    done
    [[ -n "$old" && -n "$new" ]] || die "rename needs two names:  git shuttle rename old_name new_name"
    need_repo
    refuse_operation
    valid_branch_name "$new" || die "'$new' is not a valid branch name"
    git show-ref -q --verify "refs/heads/$old" || die "there is no local branch '$old'"
    [[ "$old" != "$new" ]] || die "the new name is the old one"
    is_protected "$old" && die "'$old' is a protected branch: it is not renamed"
    is_protected "$new" && die "'$new' is the name of a protected branch"
    git show-ref -q --verify "refs/heads/$new" && die "a branch called '$new' already exists"
    local remote upstream elsewhere
    remote=$(cfg_remote)
    elsewhere=$(branch_worktree "$old")
    [[ -z "$elsewhere" ]] || die "'$old' is checked out in another worktree ($elsewhere)"
    upstream=$(upstream_of "$old")
    if (( remote_too )); then
        [[ "$upstream" == "$remote/"* ]] || die "'$old' has no upstream on '$remote': there is nothing to rename there"
        git show-ref -q --verify "refs/remotes/$remote/$new" && die "'$new' already exists on '$remote'"
    fi
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "rename:     $old -> $new$( (( remote_too )) && echo " (and on $remote)")"
    [[ -z "$upstream" || $remote_too == 1 ]] || info "its upstream stays $upstream (the remote keeps the old name)"
    confirm "Rename '$old'?"
    run git branch -m "$old" "$new" || die "cannot rename"
    if (( remote_too )); then
        run git push -u "$remote" "$new" || stop "the new name could not be pushed: '$new' exists only here for now (the old one is untouched on $remote)"
        run git push "$remote" --delete "${upstream#"$remote"/}" || warn "'${upstream#"$remote"/}' could not be deleted on $remote: delete it there by hand"
    fi
    step "'$new'"
}
