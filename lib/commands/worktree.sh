# shellcheck shell=bash
# git shuttle worktree list [--porcelain]
# git shuttle worktree add PATH BRANCH [--new FROM]   another folder with a branch checked out (--new: a new branch cut from FROM)
# git shuttle worktree remove PATH [--force]          remove a folder made that way
#
# PATH must be outside the repository (never inside .git) and must not exist, or be empty.

# worktree_path_problem PATH — why PATH cannot hold a worktree (nothing when it can).
worktree_path_problem() {
    local path=$1 top common parent
    [[ "$path" == /* ]] || { echo "the folder must be an absolute path"; return 0; }
    [[ "$path" != *$'\n'* && "$path" != *..* ]] || { echo "the folder is not valid"; return 0; }
    top=$(git rev-parse --show-toplevel); common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
    parent=$(dirname "$path")
    [[ -d "$parent" ]] || { echo "the parent folder '$parent' does not exist"; return 0; }
    parent=$(cd "$parent" && pwd -P)/$(basename "$path")
    case "$parent/" in
        "$common"/*) echo "the folder is inside the git directory"; return 0 ;;
        "$top"/*) echo "the folder is inside this repository"; return 0 ;;
    esac
    if [[ -e "$path" ]] && { [[ ! -d "$path" ]] || [[ -n "$(ls -A "$path")" ]]; }; then echo "'$path' exists and is not an empty folder"; fi
    return 0
}

cmd_worktree() {
    local sub=${1:-list}; shift || true
    need_repo
    case "$sub" in
        list) worktree_list "$@" ;;
        add) worktree_add "$@" ;;
        remove) worktree_remove "$@" ;;
        *) die "worktree: list, add or remove" ;;
    esac
}

# worktree_list — porcelain: NUL separated "path US branch US head US main(1|0)".
worktree_list() {
    local porcelain=0 first=1 path="" branch="" head="" line
    [[ "${1:-}" != --porcelain ]] || porcelain=1
    while IFS= read -r line; do
        case "$line" in
            "worktree "*) path=${line#worktree } ;;
            "HEAD "*) head=${line#HEAD } ;;
            "branch "*) branch=${line#branch refs/heads/} ;;
            "")
                [[ -n "$path" ]] || continue
                if (( porcelain )); then printf '%s\x1f%s\x1f%s\x1f%s\0' "$path" "$branch" "${head:0:7}" "$first"
                else printf '%s  %s  %s\n' "$path" "${branch:-(detached)}" "${head:0:7}"; fi
                path=""; branch=""; head=""; first=0 ;;
        esac
    done < <(git worktree list --porcelain; echo)
}

worktree_add() {
    local path="" branch="" from="" positional=0
    while (( $# )); do
        case "$1" in
            --new) [[ $# -ge 2 ]] || die "--new needs the commit or branch to start from"; from=$2; shift 2 ;;
            -*) die "worktree add: unknown option '$1'" ;;
            *) (( positional == 0 )) && path=$1 || branch=$1; positional=$((positional + 1)); shift ;;
        esac
    done
    [[ -n "$path" && -n "$branch" ]] || die "worktree add needs a folder and a branch:  git shuttle worktree add /work/feature feature/x"
    if [[ "$branch" == -* ]] || ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then die "'$branch' is not a valid branch name"; fi
    local problem; problem=$(worktree_path_problem "$path")
    [[ -z "$problem" ]] || die "$problem"
    if [[ -n "$from" ]]; then
        git show-ref -q --verify "refs/heads/$branch" && die "a branch called '$branch' already exists"
        need_commit "$from"
        info "worktree:   $path, with a new branch '$branch' from $(git log -1 --format='%h %s' "$COMMIT")"
        confirm "Add it?"
        run git worktree add -q -b "$branch" -- "$path" "$COMMIT" || die "cannot add the worktree"
    else
        git show-ref -q --verify "refs/heads/$branch" || die "there is no local branch '$branch' (use --new to create it)"
        [[ -z "$(branch_worktree "$branch")" ]] || die "'$branch' is already checked out in $(branch_worktree "$branch")"
        info "worktree:   $path, on '$branch'"
        confirm "Add it?"
        run git worktree add -q -- "$path" "$branch" || die "cannot add the worktree"
    fi
    step "worktree $path"
}

worktree_remove() {
    local path="" force=0
    while (( $# )); do
        case "$1" in
            --force) force=1; shift ;;
            -*) die "worktree remove: unknown option '$1'" ;;
            *) [[ -z "$path" ]] || die "worktree remove: give one folder"; path=$1; shift ;;
        esac
    done
    [[ -n "$path" ]] || die "worktree remove needs the folder"
    local top; top=$(git rev-parse --show-toplevel)
    [[ "$(cd "$path" 2>/dev/null && pwd -P)" != "$top" ]] || die "that is the folder you are in"
    git worktree list --porcelain | grep -qxF "worktree $path" || die "'$path' is not a worktree of this repository"
    [[ "$(git worktree list --porcelain | head -n 1)" != "worktree $path" ]] || die "that is the main folder of the repository"
    info "remove:     $path (the branch stays)"
    confirm "Remove the folder?"
    if (( force )); then run git worktree remove --force -- "$path" || die "cannot remove it"
    else run git worktree remove -- "$path" || die "cannot remove it (changes inside? --force throws them away)"; fi
    step "removed $path"
}
