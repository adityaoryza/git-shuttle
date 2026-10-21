# shellcheck shell=bash
# Questions about commits and branches that the history-changing commands ask before they act
#
# Sourced by bin/git-shuttle: it only defines functions.

# need_commit REF — sets COMMIT to the full id of a commit of this repository, or stops. Call it directly, never inside $( ).
# shellcheck disable=SC2034  # COMMIT is read by the commands
need_commit() {
    have_ref "$1" || die "'$1' is not a commit of this repository"
    COMMIT=$(git rev-parse "$1^{commit}")
}

# remote_branches_containing COMMIT — the remote-tracking branches that have the commit, one per line.
remote_branches_containing() { git branch -r --contains "$1" 2>/dev/null | sed 's/^[ *]*//; /->/d'; }

# commit_pushed COMMIT — true when some remote branch has it.
commit_pushed() { [[ -n "$(remote_branches_containing "$1")" ]]; }

# pushed_in_range RANGE — the commits of the range (a..b) that a remote has, one per line (short id and subject).
pushed_in_range() {
    local c
    while IFS= read -r c; do
        commit_pushed "$c" && git log -1 --format='%h %s' "$c"
    done < <(git rev-list "$1")
    return 0
}

# refuse_pushed RANGE WHAT [allow] — history that is on a remote is not rewritten, unless the caller has been told to.
refuse_pushed() {
    local pushed; pushed=$(pushed_in_range "$1")
    [[ -n "$pushed" ]] || return 0
    if [[ "${3:-0}" == 1 ]]; then
        warn "these commits are on a remote: $2 rewrites them, and the next push needs  git shuttle push --force-with-lease"
        printf '  %s\n' "$pushed" >&2
        return 0
    fi
    printf '%serror:%s %s would rewrite commits that are on a remote:\n' "$C_RED" "$C_OFF" "$2" >&2
    printf '  %s\n' "$pushed" >&2
    printf 'Only commits that nobody can have yet are rewritten; pass --allow-pushed if you know what that means.\n' >&2
    exit "$EX_REFUSED"
}

# branch_worktree BRANCH — the folder of another worktree that has the branch checked out (nothing when none).
branch_worktree() {
    local line path="" here; here=$(git rev-parse --show-toplevel)
    while IFS= read -r line; do
        case "$line" in
            "worktree "*) path=${line#worktree } ;;
            "branch refs/heads/$1") [[ "$path" == "$here" ]] || { printf '%s' "$path"; return 0; } ;;
        esac
    done < <(git worktree list --porcelain 2>/dev/null)
    return 0
}

# is_merge_commit COMMIT
is_merge_commit() { [[ "$(git rev-list --parents -n 1 "$1" | wc -w)" -gt 2 ]]; }

# valid_branch_name NAME — also refuses a name that looks like an option.
valid_branch_name() { [[ "$1" != -* ]] && git check-ref-format --branch "$1" >/dev/null 2>&1; }
