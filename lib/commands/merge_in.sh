# shellcheck shell=bash
# git shuttle merge-in BRANCH [--ff | --no-ff | --ff-only] — merge another branch into the one you are on
#
# Not into a protected branch (that is what `merge` and `ship` are for), not with uncommitted changes. A conflict stops it with
# `continue` and `abort` to finish or give up.

cmd_merge_in() {
    local other="" mode=ff
    while (( $# )); do
        case "$1" in
            --ff) mode=ff; shift ;;
            --no-ff) mode=no-ff; shift ;;
            --ff-only) mode=ff-only; shift ;;
            -*) die "merge-in: unknown option '$1'" ;;
            *) [[ -z "$other" ]] || die "merge-in: give one branch"; other=$1; shift ;;
        esac
    done
    [[ -n "$other" ]] || die "merge-in needs a branch:  git shuttle merge-in feature/other"
    need_repo
    refuse_operation
    need_commit "$other"
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "merge-in"
    require_clean_tree
    [[ "$other" != "$branch" ]] || die "that is the branch you are on"
    if git merge-base --is-ancestor "$COMMIT" HEAD; then info "'$branch' already contains $other: nothing to merge."; return 0; fi
    local n; n=$(git rev-list --count "HEAD..$COMMIT")
    show_where "$branch"
    info "merge:      $other ($n commit(s)) into '$branch' ($mode)"
    confirm "Merge '$other' into '$branch'?"
    local flag=()
    case "$mode" in no-ff) flag=(--no-ff) ;; ff-only) flag=(--ff-only) ;; esac
    run git merge --no-edit "${flag[@]}" "$other" || {
        [[ -n "$(unmerged_files)" ]] && stop "the merge of '$other' hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
        die "cannot merge '$other'$([[ $mode == ff-only ]] && echo ' without a merge commit (the branches diverged)')"
    }
    step "'$other' is in '$branch'"
}
