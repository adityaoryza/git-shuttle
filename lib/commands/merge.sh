# shellcheck shell=bash
# git shuttle merge [--into BRANCH] [--no-sync] [--force-with-lease]
#
# The whole way from a feature branch to the integration branch: rebase on it, push the branch, update the local
# integration branch, merge, push it, and come back. It stops at the first thing that fails and says how to go on.

cmd_merge() {
    local into="" sync=1 force=0
    while (( $# )); do
        case "$1" in
            --into) [[ $# -ge 2 ]] || die "--into needs a branch"; into=$2; shift 2 ;;
            --no-sync) sync=0; shift ;;
            --force-with-lease) force=1; shift ;;
            *) die "merge: unknown argument '$1'" ;;
        esac
    done
    need_repo
    refuse_operation
    local branch strategy remote
    need_branch; branch=$BRANCH
    refuse_protected "$branch" "merge"
    require_clean_tree
    load_branches
    into=${into:-$INTEGRATION}
    [[ "$branch" != "$into" ]] || die "'$branch' is the branch to merge into: check out your feature branch"
    strategy=$(cfg mergeStrategy); strategy=${strategy:-noff}
    [[ "$strategy" == noff || "$strategy" == ff-only ]] || die "shuttle.mergeStrategy must be 'noff' or 'ff-only', not '$strategy'"
    remote=$(cfg_remote)

    show_where "$branch"
    info "merge into: $into  ($strategy)"
    info "steps:      $( ((sync)) && printf 'fetch, rebase on %s/%s, ' "$remote" "$into")push $branch, update $into, merge, push $into, back to $branch"
    confirm "Ship '$branch' to '$into'?"

    fetch_remote
    have_ref "refs/remotes/$remote/$into" || die "the branch '$into' does not exist on '$remote' (git config shuttle.integration <branch>)"
    if ! assume_committed && git merge-base --is-ancestor "$branch" "$remote/$into"; then
        info "'$branch' is already in $remote/$into: nothing to merge."
        return 0
    fi

    # The push of the integration branch sends everything the local branch has: commits of its own must not ride along.
    if git show-ref -q --verify "refs/heads/$into"; then
        local own
        own=$(git rev-list --count "$remote/$into..refs/heads/$into")
        (( own == 0 )) || die "the local '$into' has $own commit(s) that $remote/$into does not: the merge would push them too.
  Look at them with  git log $remote/$into..$into  and push or drop them first."
    fi

    (( sync )) && sync_branch "$branch" "$into"
    push_branch "$branch" "$force"

    run git checkout "$into" || stop "cannot check out '$into'."
    run git pull --ff-only "$remote" "$into" || stop "the local '$into' cannot be brought up to date with $remote/$into (it has commits of its own?).
  You are on '$into'. Fix it, then  git checkout $branch  and run this again."

    if [[ "$strategy" == ff-only ]]; then
        run git merge --ff-only "$branch" || stop "'$branch' cannot be fast-forwarded into '$into'.
  You are on '$into'. Rebase '$branch' on it (git shuttle sync), then run this again."
    else
        run git merge --no-ff -m "Merge branch '$branch' into $into" "$branch" || stop "the merge hit a conflict. You are on '$into'.
  Resolve the files, then  git add <files> && git commit
  and finish with           git push $remote $into && git checkout $branch
  or give up with           git merge --abort"
    fi

    run git push "$remote" "$into" || stop "the push of '$into' was rejected (someone pushed in the meantime?).
  You are on '$into', with the merge done locally. Run  git pull --rebase $remote $into  and push again,
  then  git checkout $branch"
    run git checkout "$branch" || stop "merged and pushed, but cannot go back to '$branch'."
    step "done: '$branch' is in '$into' on $remote"
}
