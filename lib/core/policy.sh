# shellcheck shell=bash
# The rules of the repository: protected branches and commit messages
#
# Sourced by bin/git-shuttle: it only defines functions.

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
