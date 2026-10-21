# shellcheck shell=bash
# git shuttle branch NAME [COMMIT] — a new local branch at a commit (default: where you are), and switch to it

cmd_branch() {
    local name="" at=""
    while (( $# )); do
        case "$1" in
            -*) die "branch: unknown option '$1'" ;;
            *) if [[ -z "$name" ]]; then name=$1; elif [[ -z "$at" ]]; then at=$1; else die "branch: a name and at most one commit"; fi; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "branch needs a name:  git shuttle branch feature/my_task [commit]"
    need_repo
    refuse_operation
    git check-ref-format --branch "$name" >/dev/null 2>&1 || die "'$name' is not a valid branch name"
    git show-ref -q --verify "refs/heads/$name" && die "the branch '$name' already exists"
    at=${at:-HEAD}
    have_ref "$at" || die "'$at' is not a commit of this repository"
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "new branch: $name, at $(git log -1 --format='%h %s' "$at")"
    confirm "Create '$name' and switch to it?"
    run git checkout --no-track -b "$name" "$at" || die "cannot create '$name' (uncommitted changes in the way?)"
    step "on '$name'"
}
