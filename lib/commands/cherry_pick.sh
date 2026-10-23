# shellcheck shell=bash
# git shuttle cherry-pick COMMIT... — take commits from anywhere onto the branch you are on, in the order given
#
# Not for protected branches (use `release` or `pick` to build a release branch). A commit the branch already has, or one
# that would change nothing, is skipped. A conflict leaves the cherry-pick waiting: `continue` (which goes on with the rest) or `abort`.
# --push pushes the branch when the last commit is picked.

cmd_cherry_pick() {
    local commits=() strat="" push=0
    while (( $# )); do
        case "$1" in
            -X|--strategy-option) [[ $# -ge 2 ]] || die "$1 needs a value (ours or theirs)"; strat=$2; shift 2 ;;
            --push) push=1; shift ;;
            -*) die "cherry-pick: unknown option '$1'" ;;
            *) commits+=("$1"); shift ;;
        esac
    done
    (( ${#commits[@]} )) || die "cherry-pick needs at least one commit:  git shuttle cherry-pick <commit>..."
    [[ -z "$strat" || "$strat" == ours || "$strat" == theirs ]] || die "--strategy-option must be 'ours' or 'theirs'"
    need_repo
    refuse_operation
    need_branch
    refuse_protected "$BRANCH" "cherry-pick"
    require_clean_tree

    local c sha parents resolved=() skipped=0
    for c in "${commits[@]}"; do
        have_ref "$c" || die "'$c' is not a commit of this repository"
        sha=$(git rev-parse "$c^{commit}")
        parents=$(git rev-list --parents -n 1 "$sha")
        # shellcheck disable=SC2086
        set -- $parents
        (( $# <= 2 )) || die "'$c' is a merge commit: pick the commits it brought, not the merge"
        if git merge-base --is-ancestor "$sha" HEAD; then
            info "$(git log -1 --format='%h %s' "$sha") is already in '$BRANCH': skipped."
            skipped=$((skipped + 1))
            continue
        fi
        resolved+=("$sha")
    done
    (( ${#resolved[@]} )) || die "nothing to pick: '$BRANCH' already has ${skipped:+these }commits"

    show_where "$BRANCH"
    info "commits:    ${#resolved[@]}, in this order"
    for sha in "${resolved[@]}"; do info "  $(git log -1 --format='%h %s' "$sha")"; done
    confirm "Cherry-pick them onto '$BRANCH'?"

    pick_plan_start "$BRANCH" "" "$strat" "$push" cherry-pick "${resolved[@]}"
    pick_run 1
}
