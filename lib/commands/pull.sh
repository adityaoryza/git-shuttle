# shellcheck shell=bash
# git shuttle pull [--ff-only | --rebase | --merge] [--branch NAME] — bring a branch up to date with its upstream
#
# --ff-only (the default) moves the branch forward and refuses when it has commits of its own; --rebase replays them on top of the
# upstream (not on a protected branch, and the next push then needs --force-with-lease if they were pushed); --merge merges the upstream
# into it (a merge commit when it has commits of its own; not on a protected branch either).
# --branch NAME updates another branch without checking it out, and only by moving it forward.

cmd_pull() {
    local mode=ff other=""
    while (( $# )); do
        case "$1" in
            --ff-only) mode=ff; shift ;;
            --rebase) mode=rebase; shift ;;
            --merge) mode=merge; shift ;;
            --branch) [[ $# -ge 2 ]] || die "--branch needs a branch name"; other=$2; shift 2 ;;
            *) die "pull: unknown argument '$1'" ;;
        esac
    done
    need_repo
    refuse_operation
    if [[ -n "$other" ]]; then pull_other "$other" "$mode"; return; fi
    local branch upstream behind ahead
    need_branch; branch=$BRANCH
    upstream=$(upstream_of "$branch")
    [[ -n "$upstream" ]] || die "'$branch' has no upstream: publish it with  git shuttle push  (or set one with  git shuttle upstream)"
    require_clean_tree
    show_where "$branch"
    info "pull:       $upstream into $branch ($mode)"
    confirm "Fetch and pull?"
    fetch_remote
    have_ref "$upstream" || die "the upstream '$upstream' no longer exists on the remote: set another with  git shuttle upstream"
    behind=$(git rev-list --count "$branch..$upstream"); ahead=$(git rev-list --count "$upstream..$branch")
    if (( behind == 0 )); then info "'$branch' is already up to date with $upstream."; return 0; fi
    if [[ "$mode" == ff ]]; then
        (( ahead == 0 )) || die "'$branch' has $ahead commit(s) that $upstream lacks and $behind that it has: they diverged. Use  git shuttle pull --rebase  (or merge)"
        run git merge --ff-only "$upstream" || die "cannot fast-forward"
        step "'$branch' moved forward by $behind commit(s)"
    elif [[ "$mode" == merge ]]; then
        refuse_protected "$branch" "pull --merge"
        info "merges:     $upstream ($behind new commit(s)) into '$branch'"
        run git merge --no-edit "$upstream" || stop "the merge of $upstream hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
        step "'$branch' now has $upstream"
    else
        refuse_protected "$branch" "pull --rebase"
        info "replays:    $ahead commit(s) of '$branch' on top of $upstream"
        run git rebase "$upstream" || stop "the rebase on $upstream hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
        step "'$branch' rebased on $upstream ($behind new commit(s) under yours)"
    fi
}

# pull_other BRANCH MODE — move a branch that is not checked out forward to its upstream, without touching the working tree.
pull_other() {
    local name=$1 mode=$2 upstream remote_branch behind ahead
    [[ "$mode" == ff ]] || die "another branch can only be moved forward: check it out to rebase or merge"
    valid_branch_name "$name" || die "'$name' is not a valid branch name"
    git show-ref -q --verify "refs/heads/$name" || die "there is no local branch '$name'"
    [[ "$name" != "$(git symbolic-ref -q --short HEAD || true)" ]] || die "'$name' is the branch you are on: use  git shuttle pull"
    [[ -z "$(branch_worktree "$name")" ]] || die "'$name' is checked out in $(branch_worktree "$name")"
    upstream=$(upstream_of "$name")
    [[ -n "$upstream" ]] || die "'$name' has no upstream"
    local remote; remote=$(cfg_remote)
    info "update:     $name from $upstream (without checking it out)"
    confirm "Fetch and move '$name' forward?"
    fetch_remote
    have_ref "$upstream" || die "the upstream '$upstream' no longer exists on the remote"
    behind=$(git rev-list --count "$name..$upstream"); ahead=$(git rev-list --count "$upstream..$name")
    if (( behind == 0 )); then info "'$name' is already up to date with $upstream."; return 0; fi
    (( ahead == 0 )) || die "'$name' has $ahead commit(s) that $upstream lacks and $behind that it has: they diverged. Check it out to rebase or merge"
    remote_branch=${upstream#"$remote"/}
    run git fetch -q "$remote" "refs/heads/$remote_branch:refs/heads/$name" || die "cannot move '$name' forward"
    step "'$name' moved forward by $behind commit(s)"
}
