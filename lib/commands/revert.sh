# shellcheck shell=bash
# git shuttle revert COMMIT — a new commit that undoes a commit (not a merge commit; not on a protected branch)

cmd_revert() {
    local target=""
    while (( $# )); do
        case "$1" in
            -*) die "revert: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "revert: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$target" ]] || die "revert needs a commit:  git shuttle revert <commit>"
    need_repo
    refuse_operation
    need_commit "$target"
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "revert"
    require_clean_tree
    is_merge_commit "$COMMIT" && die "'$target' is a merge commit: revert the commits it brought instead"
    show_where "$branch"
    info "revert:     $(git log -1 --format='%h %s' "$COMMIT")"
    confirm "Revert it on '$branch'?"
    run git revert --no-edit "$COMMIT" || {
        [[ -n "$(unmerged_files)" ]] && stop "the revert hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
        die "cannot revert"
    }
    step "reverted $(git log -1 --format=%h "$COMMIT" 2>/dev/null || echo "$target")"
}
