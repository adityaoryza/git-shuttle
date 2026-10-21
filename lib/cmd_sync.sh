# shellcheck shell=bash
# git shuttle sync [--onto BRANCH] — fetch, then rebase the current branch on the remote integration branch

# sync_branch BRANCH ONTO — the shared part, also used by merge. Returns 0 when the branch is up to date afterwards.
sync_branch() {
    local branch=$1 onto=$2 remote target
    remote=$(cfg_remote)
    target="$remote/$onto"
    have_ref "refs/remotes/$target" || die "the branch '$onto' does not exist on '$remote' (git config shuttle.integration <branch>)"
    if git merge-base --is-ancestor "$target" "$branch"; then
        info "'$branch' already contains $target: nothing to rebase."
        return 0
    fi
    if [[ -n "$(upstream_of "$branch")" ]]; then
        warn "'$branch' is already pushed: the rebase rewrites it, and the next push needs  git shuttle push --force-with-lease"
    fi
    run git rebase "$target" || stop "the rebase on $target hit a conflict.
  Resolve the files, then  git add <files> && git rebase --continue
  or give up with         git rebase --abort"
}

cmd_sync() {
    local onto=""
    while (( $# )); do
        case "$1" in
            --onto) [[ $# -ge 2 ]] || die "--onto needs a branch"; onto=$2; shift 2 ;;
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
    info "rebase on:  $(cfg_remote)/$onto"
    confirm "Fetch and rebase?"
    fetch_remote
    sync_branch "$branch" "$onto"
}
