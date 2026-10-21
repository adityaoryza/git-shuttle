# shellcheck shell=bash
# git shuttle switch BRANCH — check a branch out; a branch that exists only on the remote gets a local copy that tracks it
# git shuttle switch --detach COMMIT — look at a commit without being on a branch (a new branch can be made from there)

cmd_switch() {
    local name="" detach=0
    while (( $# )); do
        case "$1" in
            --detach) detach=1; shift ;;
            -*) die "switch: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "switch: give one branch"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "switch needs a branch:  git shuttle switch feature/my_task"
    need_repo
    refuse_operation
    if (( detach )); then
        need_commit "$name"
        show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
        info "look at:    $(git log -1 --format='%h %s' "$COMMIT") (no branch: commits made there are easy to lose)"
        confirm "Check it out?"
        run git checkout -q --detach "$COMMIT" || die "cannot check it out (uncommitted changes in the way?)"
        step "on $(git rev-parse --short "$COMMIT"), detached; \"git shuttle branch NAME\" keeps work made here"
        return 0
    fi
    local remote current
    remote=$(cfg_remote)
    name=${name#"$remote"/}
    git check-ref-format --branch "$name" >/dev/null 2>&1 || die "'$name' is not a valid branch name"
    current=$(git symbolic-ref -q --short HEAD || true)
    [[ "$current" != "$name" ]] || { info "already on '$name'"; return 0; }
    show_where "${current:-(detached)}"
    if git show-ref -q --verify "refs/heads/$name"; then
        confirm "Switch to '$name'?"
        run git checkout "$name" || die "cannot switch to '$name' (uncommitted changes in the way?)"
    elif have_ref "refs/remotes/$remote/$name"; then
        confirm "Switch to '$name' (a local copy of $remote/$name)?"
        run git checkout --track -b "$name" "$remote/$name" || die "cannot switch to '$name' (uncommitted changes in the way?)"
    else
        die "there is no branch '$name', locally or on '$remote'"
    fi
    step "on '$name'"
}
