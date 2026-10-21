# shellcheck shell=bash
# Questions asked to the repository, and the checks every command makes before it changes anything
#
# Sourced by bin/git-shuttle: it only defines functions.

# need_repo — be inside a work tree; sets REPO_ROOT and REPO_NAME.
need_repo() {
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
    REPO_NAME=$(basename "$REPO_ROOT")
}

# need_branch — sets BRANCH to the checked out branch; a detached HEAD has none. Call it directly, never inside $( ).
# shellcheck disable=SC2034  # BRANCH is read by the commands
need_branch() {
    BRANCH=$(git symbolic-ref -q --short HEAD 2>/dev/null) || die "HEAD is detached: check out a branch first"
}

# Where we are, printed before anything that changes the repository: it is how a command run in the wrong repository
# is noticed before it does harm.
show_where() { # branch
    info "repository: ${C_BLD}${REPO_NAME}${C_OFF} ($REPO_ROOT)"
    info "branch:     ${C_BLD}$1${C_OFF}"
}

# protected_list — the branches no command here writes to directly (shuttle.protected, default: base, integration, release,
# main and master).
protected_list() {
    local list integration release
    list=$(cfg protected)
    if [[ -z "$list" ]]; then
        integration=$(cfg integration); release=$(cfg release)
        list="$(detect_base) $integration $release main master"
    fi
    printf '%s' "${list//,/ }"
}

is_protected() { # branch
    local p
    for p in $(protected_list); do [[ "$p" == "$1" ]] && return 0; done
    return 1
}

# refuse_protected BRANCH WHAT — the work goes on a feature branch.
refuse_protected() {
    is_protected "$1" || return 0
    die "'$1' is a protected branch: $2 on a feature branch (protected: $(protected_list))"
}

# assume_committed — a dry run of a sequence (commits, then a merge): the steps after a commit assume it was made.
assume_committed() { [[ "${ASSUME_COMMITTED:-0}" == 1 || "${GIT_SHUTTLE_ASSUME_COMMITTED:-0}" == 1 ]]; }

# require_clean_tree — no staged or unstaged change to tracked files (new, untracked files are ignored).
require_clean_tree() {
    # A dry run of ship does not commit what is staged: the steps after the commit assume it was made.
    assume_committed && return 0
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        die "the working tree has uncommitted changes: commit or stash them first"
    fi
}

# have_ref REF — the reference exists.
have_ref() { git rev-parse --verify -q "$1^{commit}" >/dev/null 2>&1; }

# remote_ref BRANCH — the remote-tracking reference of a branch, after a fetch.
remote_ref() { printf 'refs/remotes/%s/%s' "$(cfg_remote)" "$1"; }

# fetch_remote — update the remote-tracking branches; a fetch changes no branch of yours.
fetch_remote() {
    local remote; remote=$(cfg_remote)
    git remote get-url "$remote" >/dev/null 2>&1 || die "no remote named '$remote' (git config shuttle.remote <name>)"
    run git fetch --quiet "$remote" || die "cannot fetch from '$remote'"
}

# upstream_of BRANCH — the upstream of a branch (empty when it has none).
upstream_of() { git rev-parse --abbrev-ref --symbolic-full-name "$1@{upstream}" 2>/dev/null || true; }

# --- commit message rules (shuttle.messagePattern, shuttle.forbidTrailers) ---------------------------------

# message_problem TEXT — prints why a commit message is refused; prints nothing when it is fine.
message_problem() {
    local text=$1 subject line pattern trailer
    subject=$(printf '%s\n' "$text" | sed '/^#/d' | sed -n '/./{p;q}')
    [[ -n "$subject" ]] || { echo "the message is empty"; return 0; }
    # Messages git or the user generate on purpose are not checked.
    case "$subject" in Merge\ *|Revert\ \"*|fixup!\ *|squash!\ *|amend!\ *) return 0 ;; esac
    pattern=$(cfg messagePattern)
    if [[ -n "$pattern" ]]; then
        local rc
        [[ "$subject" =~ $pattern ]]; rc=$?
        (( rc == 2 )) && { echo "shuttle.messagePattern is not a valid regular expression: $pattern"; return 0; }
        (( rc == 1 )) && { echo "the first line does not match shuttle.messagePattern ($pattern): $subject"; return 0; }
    fi
    for trailer in $(cfg forbidTrailers); do
        [[ "$trailer" =~ ^[A-Za-z0-9-]+$ ]] || { echo "shuttle.forbidTrailers: '$trailer' is not a trailer name"; return 0; }
        while IFS= read -r line; do
            [[ "${line,,}" == "${trailer,,}:"* ]] && { echo "the message has a '$trailer:' line, which this repository forbids"; return 0; }
        done < <(printf '%s\n' "$text" | sed 's/^[[:space:]]*//')
    done
    return 0
}

# --- an operation that stopped half way ---------------------------------------------------------------------------

# operation_in_progress — prints rebase, merge or cherry-pick when one is waiting to be finished (nothing otherwise).
operation_in_progress() {
    local gd; gd=$(git rev-parse --git-dir 2>/dev/null) || return 0
    if [[ -d "$gd/rebase-merge" || -d "$gd/rebase-apply" ]]; then printf 'rebase'
    elif [[ -f "$gd/MERGE_HEAD" ]]; then printf 'merge'
    elif [[ -f "$gd/CHERRY_PICK_HEAD" ]]; then printf 'cherry-pick'
    fi
}

# refuse_operation — nothing new is started while another operation waits for you.
refuse_operation() {
    local op; op=$(operation_in_progress)
    [[ -z "$op" ]] || die "a $op is waiting to be finished: resolve the conflicts, then  git shuttle continue  (or give up with  git shuttle abort)"
}

# unmerged_files — the files in conflict, one per line.
unmerged_files() { git diff --name-only --diff-filter=U; }
