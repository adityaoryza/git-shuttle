# shellcheck shell=bash
# git shuttle sync [--onto BRANCH] [--merge] — fetch, then rebase the current branch on the remote integration branch
# (--merge merges it into the branch instead: for a branch that others already have)

# sync_branch BRANCH ONTO [merge] — the shared part, also used by merge. Returns 0 when the branch is up to date afterwards.
sync_branch() {
    local branch=$1 onto=$2 how=${3:-rebase} remote target replay behind
    remote=$(cfg_remote)
    target="$remote/$onto"
    have_ref "refs/remotes/$target" || die "the branch '$onto' does not exist on '$remote' (git config shuttle.integration <branch>)"
    if git merge-base --is-ancestor "$target" "$branch"; then
        info "'$branch' already contains $target: nothing to $how."
        return 0
    fi
    behind=$(git rev-list --count "$branch..$target"); replay=$(git rev-list --count "$target..$branch")
    if [[ "$how" == merge ]]; then
        info "brings in:  $behind new commit(s) of $target, in a merge commit"
        run git merge --no-edit "$target" || stop "the merge of $target hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
        return 0
    fi
    info "replays:    $replay commit(s) of '$branch' on top of $target ($behind new)"
    if [[ -n "$(upstream_of "$branch")" ]]; then
        warn "'$branch' is already pushed: the rebase rewrites it, and the next push needs  git shuttle push --force-with-lease"
    fi
    run git rebase "$target" || stop "the rebase on $target hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
}

cmd_sync() {
    local onto="" how=rebase
    while (( $# )); do
        case "$1" in
            --onto) [[ $# -ge 2 ]] || die "--onto needs a branch"; onto=$2; shift 2 ;;
            --merge) how=merge; shift ;;
            *) die "sync: unknown argument '$1'" ;;
        esac
    done
    need_repo
    refuse_operation
    local branch
    need_branch; branch=$BRANCH
    refuse_protected "$branch" "sync"
    require_clean_tree
    load_branches
    onto=${onto:-$INTEGRATION}
    [[ "$branch" != "$onto" ]] || die "'$branch' is the branch to rebase on: check out your feature branch"
    show_where "$branch"
    info "$how:     $(cfg_remote)/$onto into '$branch'"
    confirm "Fetch and $how?"
    fetch_remote
    sync_branch "$branch" "$onto" "$how"
}
