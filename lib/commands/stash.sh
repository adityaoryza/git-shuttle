# shellcheck shell=bash
# git shuttle stash [push] [-m MESSAGE] [--include-untracked]   put the uncommitted changes aside
# git shuttle stash list [--porcelain]                          what is set aside
# git shuttle stash apply|pop|drop N                            bring one back (pop: and forget it), or forget it
# git shuttle stash show N [--porcelain]                        what is in one
#
# N is the number the list shows (0 is the newest). pop and apply stop, keeping the stash, when they would hit a conflict.

# stash_index VALUE — sets STASH_REF to stash@{N} for a number that exists, or stops.
# shellcheck disable=SC2034  # STASH_REF is read by the callers
stash_index() {
    [[ "$1" =~ ^[0-9]{1,4}$ ]] || die "give the number of the stash, as  git shuttle stash list  shows it"
    git rev-parse -q --verify "refs/stash@{$1}" >/dev/null 2>&1 || die "there is no stash number $1"
    STASH_REF="stash@{$1}"
}

cmd_stash() {
    local sub=push
    case "${1:-}" in
        push|list|apply|pop|drop|show) sub=$1; shift ;;
    esac
    need_repo
    case "$sub" in
        push) stash_push "$@" ;;
        list) stash_list "$@" ;;
        show) stash_show "$@" ;;
        *) stash_use "$sub" "$@" ;;
    esac
}

stash_push() {
    local message="" untracked=0
    while (( $# )); do
        case "$1" in
            -m) [[ $# -ge 2 ]] || die "-m needs the message"; message=$2; shift 2 ;;
            --include-untracked|-u) untracked=1; shift ;;
            *) die "stash: unknown argument '$1'" ;;
        esac
    done
    refuse_operation
    local changed; changed=$(git status --porcelain --untracked-files="$( (( untracked )) && echo all || echo no)" | head -n 1)
    [[ -n "$changed" ]] || die "there is nothing to stash"
    local current; current=$(git symbolic-ref -q --short HEAD || echo "(detached)")
    message=${message:-"git-shuttle: changes of '$current'"}
    info "stash:      the uncommitted changes of '$current'$( (( untracked )) && echo ", new files included")"
    confirm "Put them aside?"
    local args=(stash push -m "$message")
    (( untracked )) && args+=(--include-untracked)
    # No pathspec is given here, and with GIT_LITERAL_PATHSPECS=1 (the web UI sets it) git stash leaves the new files behind.
    GIT_LITERAL_PATHSPECS=0 run git "${args[@]}" || die "cannot stash"
    step "stashed"
}

# stash_list [--porcelain] — porcelain: NUL separated records "N US commit US date US subject".
stash_list() {
    local porcelain=0
    [[ "${1:-}" != --porcelain ]] || porcelain=1
    if (( porcelain )); then
        local i=0 line
        while IFS= read -r line; do
            printf '%s\x1f%s\0' "$i" "$line"; i=$((i + 1))
        done < <(git stash list --format='%h%x1f%cI%x1f%gs')
        return 0
    fi
    git stash list --format='%gd  %h  %cr  %gs'
}

stash_show() {
    local porcelain=0 n=""
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            -*) die "stash show: unknown option '$1'" ;;
            *) [[ -z "$n" ]] || die "stash show: give one number"; n=$1; shift ;;
        esac
    done
    stash_index "${n:-x}"
    if (( porcelain )); then git stash show --include-untracked -p "$STASH_REF"; else git stash show --include-untracked --stat "$STASH_REF"; fi
}

stash_use() {
    local sub=$1; shift
    local n=${1:-x}
    [[ $# -le 1 ]] || die "stash $sub: give one number"
    stash_index "$n"
    local what; what=$(git log -1 --format='%gs' "$STASH_REF")
    info "stash:      $n  $what"
    if [[ "$sub" != drop ]]; then
        refuse_operation
        require_clean_tree
    fi
    case "$sub" in
        drop) confirm "Forget this stash for good?" ;;
        pop) confirm "Bring it back and forget it?" ;;
        *) confirm "Bring it back (the stash stays)?" ;;
    esac
    case "$sub" in
        drop) run git stash drop -q "$STASH_REF" || die "cannot drop" ;;
        *) run git stash "$sub" -q "$STASH_REF" || {
               [[ -n "$(unmerged_files)" ]] && stop "the stash conflicts with your files: resolve them (the stash is kept), then commit or discard"
               die "cannot $sub: nothing was changed (files with changes in the way?)"
           } ;;
    esac
    step "stash $sub done"
}
