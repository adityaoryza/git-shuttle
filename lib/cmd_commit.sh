# shellcheck shell=bash
# git shuttle commit -m MESSAGE [-- PATH...] — a commit that checks the message and the place first

cmd_commit() {
    local message="" allow_protected=0 paths=()
    while (( $# )); do
        case "$1" in
            -m|--message) [[ $# -ge 2 ]] || die "$1 needs a message"; message=$2; shift 2 ;;
            --allow-protected) allow_protected=1; shift ;;
            --) shift; paths=("$@"); break ;;
            -*) die "commit: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done
    [[ -n "$message" ]] || die "commit needs a message:  git shuttle commit -m \"[TAG] area: summary\" [-- paths]"

    need_repo
    refuse_operation
    local branch problem
    need_branch; branch=$BRANCH
    (( allow_protected )) || refuse_protected "$branch" "commit"

    problem=$(message_problem "$message")
    [[ -z "$problem" ]] || die "$problem"

    if (( ${#paths[@]} )); then
        [[ -n "$(git status --porcelain -- "${paths[@]}")" ]] \
            || die "nothing to commit in: ${paths[*]} (new files need  git add  first)"
    else
        git diff --cached --quiet && die "nothing is staged: git add the files first, or name the paths"
    fi

    show_where "$branch"
    info "message:    $message"
    if (( ${#paths[@]} )); then
        info "paths:      ${paths[*]}  (only these are committed; anything else staged stays staged)"
        git status --short -- "${paths[@]}"
    else
        info "staged:"
        git diff --cached --name-status
    fi
    confirm "Commit?"
    if (( ${#paths[@]} )); then
        run git commit -m "$message" -- "${paths[@]}" || die "git commit failed"
    else
        run git commit -m "$message" || die "git commit failed"
    fi
}

# git shuttle check-message FILE — used by the commit-msg hook.
cmd_check_message() {
    [[ $# -eq 1 && -f "$1" ]] || die "check-message needs the file with the message"
    need_repo
    local problem
    problem=$(message_problem "$(cat "$1")")
    [[ -z "$problem" ]] || { printf 'git-shuttle: %s\n' "$problem" >&2; return 1; }
}
