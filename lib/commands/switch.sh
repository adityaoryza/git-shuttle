# shellcheck shell=bash
# git shuttle switch BRANCH — check a branch out; a branch that exists only on the remote gets a local copy that tracks it

cmd_switch() {
    local name=""
    while (( $# )); do
        case "$1" in
            -*) die "switch: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "switch: give one branch"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "switch needs a branch:  git shuttle switch feature/my_task"
    need_repo
    refuse_operation
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
