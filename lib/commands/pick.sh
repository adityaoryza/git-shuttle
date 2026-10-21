# shellcheck shell=bash
# git shuttle pick --onto NEW [--from BASE] [--strategy-option ours|theirs] [--push] COMMIT...
#
# A release branch made of chosen commits: it starts from the remote release branch and takes the commits one by one.

cmd_pick() {
    local onto="" from="" strat="" push=0 commits=()
    while (( $# )); do
        case "$1" in
            --onto) [[ $# -ge 2 ]] || die "--onto needs a branch name"; onto=$2; shift 2 ;;
            --from) [[ $# -ge 2 ]] || die "--from needs a branch"; from=$2; shift 2 ;;
            -X|--strategy-option) [[ $# -ge 2 ]] || die "$1 needs a value (ours or theirs)"; strat=$2; shift 2 ;;
            --push) push=1; shift ;;
            -*) die "pick: unknown option '$1'" ;;
            *)  commits+=("$1"); shift ;;
        esac
    done
    [[ -n "$onto" ]] || die "pick needs the new branch:  git shuttle pick --onto <new-branch> <commit>..."
    (( ${#commits[@]} )) || die "pick needs at least one commit"
    [[ -z "$strat" || "$strat" == ours || "$strat" == theirs ]] || die "--strategy-option must be 'ours' or 'theirs'"

    need_repo
    refuse_operation
    git check-ref-format --branch "$onto" >/dev/null 2>&1 || die "'$onto' is not a valid branch name"
    require_clean_tree
    load_branches
    from=${from:-$RELEASE}
    local remote; remote=$(cfg_remote)
    git show-ref -q --verify "refs/heads/$onto" && die "the branch '$onto' already exists"

    fetch_remote
    have_ref "refs/remotes/$remote/$from" || die "the branch '$from' does not exist on '$remote' (--from <branch>, or git config shuttle.release <branch>)"
    git show-ref -q --verify "refs/remotes/$remote/$onto" && die "the branch '$onto' already exists on '$remote'"

    local c resolved=() parents
    for c in "${commits[@]}"; do
        have_ref "$c" || die "'$c' is not a commit of this repository"
        parents=$(git rev-list --parents -n 1 "$(git rev-parse "$c^{commit}")")
        # shellcheck disable=SC2086
        set -- $parents
        (( $# <= 2 )) || die "'$c' is a merge commit: pick the commits it brought, not the merge"
        resolved+=("$(git rev-parse "$c^{commit}")")
    done

    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "new branch: $onto, from $remote/$from"
    info "commits:    ${#resolved[@]}, in this order"
    for c in "${resolved[@]}"; do info "  $(git log -1 --format='%h %s' "$c")"; done
    confirm "Create '$onto' and pick them?"

    run git checkout --no-track -b "$onto" "$remote/$from" || die "cannot create '$onto'"

    local args=() i=0 remaining
    [[ -z "$strat" ]] || args+=("--strategy-option=$strat")
    for c in "${resolved[@]}"; do
        i=$((i + 1))
        if ! run git cherry-pick "${args[@]}" "$c"; then
            if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
                remaining="${resolved[*]:$i}"
                stop "commit $(git log -1 --format='%h %s' "$c") hit a conflict (you are on '$onto').
  Resolve the files, then  git add <files> && git cherry-pick --continue${remaining:+
  then pick the rest:     git cherry-pick ${args[*]:-} $remaining}
  or give up with         git cherry-pick --abort"
            fi
            info "  $(git log -1 --format='%h' "$c") is already in $remote/$from: skipped."
            run git cherry-pick --skip || die "cannot skip the empty commit; run  git cherry-pick --abort"
        fi
    done

    step "'$onto' is ready: $(git rev-list --count "$remote/$from..HEAD") commit(s) on top of $remote/$from"
    git log --oneline "$remote/$from..HEAD"
    if (( push )); then
        push_branch "$onto" 0
    else
        info "Push it with:  git shuttle push --allow-protected   (or  git push -u $remote $onto)"
    fi
}
