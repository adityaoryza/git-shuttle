# shellcheck shell=bash
# Settings: `git config shuttle.<key>`, per repository or global, and the branches they name
#
# Sourced by bin/git-shuttle: it only defines functions.

# --- configuration: `git config shuttle.<key>` (per repository or global) -----------------------------------

cfg() { git config --get "shuttle.$1" 2>/dev/null || true; }

cfg_remote() { local r; r=$(cfg remote); printf '%s' "${r:-origin}"; }

# detect_base — the branch work starts from: shuttle.base, else the default branch of the remote, else main / master.
# Prints nothing when it cannot tell. Safe in $( ): it never exits.
detect_base() {
    local base remote ref
    base=$(cfg base)
    if [[ -z "$base" ]]; then
        remote=$(cfg_remote)
        if ref=$(git symbolic-ref -q --short "refs/remotes/$remote/HEAD" 2>/dev/null); then
            base=${ref#"$remote"/}
        elif git show-ref -q --verify "refs/remotes/$remote/main"; then base=main
        elif git show-ref -q --verify "refs/remotes/$remote/master"; then base=master
        fi
    fi
    printf '%s' "$base"
}

# load_branches — sets BASE, INTEGRATION and RELEASE, or stops. Call it directly, never inside $( ): a die in a
# command substitution only ends the substitution, and the command would go on.
# shellcheck disable=SC2034  # read by the commands
load_branches() {
    BASE=$(detect_base)
    [[ -n "$BASE" ]] || die "cannot tell the base branch: run  git config shuttle.base <branch>"
    INTEGRATION=$(cfg integration); INTEGRATION=${INTEGRATION:-$BASE}
    RELEASE=$(cfg release);         RELEASE=${RELEASE:-$BASE}
}
