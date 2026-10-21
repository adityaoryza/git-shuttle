# shellcheck shell=bash
# git shuttle status [--porcelain] — where you are and what is left to ship. It changes nothing.
#
# --porcelain prints key=value records ended by NUL, for a program to read (the web UI does). Keys that can repeat:
# file, conflict, blocker. A value never contains a NUL.

cmd_status() {
    local porcelain=0
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            *) die "status: unknown argument '$1'" ;;
        esac
    done
    need_repo

    local branch="" upstream="" up_ahead=0 up_behind=0 into="" into_ahead="" into_behind="" merged=0
    local staged unstaged untracked remote op is_protected=0 hook=0 hookfile
    local -a files=() conflicts=() blockers=()

    branch=$(git symbolic-ref -q --short HEAD 2>/dev/null) || branch=""
    remote=$(cfg_remote)
    op=$(operation_in_progress)

    if [[ -n "$branch" ]]; then
        if is_protected "$branch"; then is_protected=1; fi
        upstream=$(upstream_of "$branch")
        if [[ -n "$upstream" ]]; then read -r up_ahead up_behind < <(git rev-list --left-right --count "$branch...$upstream"); fi
        into=$(cfg integration); into=${into:-$(detect_base)}
        if [[ -n "$into" ]] && have_ref "refs/remotes/$remote/$into"; then
            read -r into_ahead into_behind < <(git rev-list --left-right --count "$branch...$remote/$into")
            if [[ "$branch" != "$into" ]] && git merge-base --is-ancestor "$branch" "$remote/$into"; then merged=1; fi
        else
            into=""
        fi
    fi

    staged=$(git diff --cached --name-only | wc -l)
    unstaged=$(git diff --name-only | wc -l)
    untracked=$(git ls-files --others --exclude-standard | wc -l)
    local entry
    while IFS= read -r -d '' entry; do
        [[ -n "$entry" ]] || continue
        files+=("$entry")
        # a rename is followed by a second record with the old path: skip it
        [[ "${entry:0:1}" == R || "${entry:1:1}" == R ]] && IFS= read -r -d '' _old
    done < <(git status --porcelain -z)
    mapfile -t conflicts < <(unmerged_files)
    hookfile="$(git rev-parse --git-path hooks)/commit-msg"
    if [[ -f "$hookfile" ]] && grep -qF "git-shuttle" "$hookfile"; then hook=1; fi

    # What stops a ship, in words: the UI shows them next to the disabled button.
    [[ -n "$branch" ]] || blockers+=("HEAD is detached: check out a branch")
    [[ -z "$op" ]] || blockers+=("a $op is waiting to be finished: continue or abort it")
    (( is_protected )) && blockers+=("'$branch' is a protected branch: work on a feature branch")
    if [[ -n "$branch" && $is_protected -eq 0 && -z "$op" ]]; then
        if (( staged == 0 )) && { [[ -z "$into" ]] || (( merged )) || [[ "${into_ahead:-0}" == 0 ]]; }; then
            blockers+=("nothing to ship: no staged changes and no commits ahead of ${into:-the integration branch}")
        fi
    fi

    if (( porcelain )); then
        local pair
        emit() { printf '%s=%s\0' "$1" "$2"; }
        emit repo.name "$REPO_NAME"; emit repo.root "$REPO_ROOT"
        emit branch "$branch"; emit protected "$is_protected"
        emit upstream "$upstream"; emit upstream.ahead "$up_ahead"; emit upstream.behind "$up_behind"
        emit integration.ref "${into:+$remote/$into}"; emit integration.ahead "$into_ahead"; emit integration.behind "$into_behind"
        emit merged "$merged"
        emit staged "$staged"; emit unstaged "$unstaged"; emit untracked "$untracked"
        for pair in "${files[@]}"; do emit file "$pair"; done
        emit operation "$op"
        for pair in "${conflicts[@]}"; do emit conflict "$pair"; done
        for pair in "${blockers[@]}"; do emit blocker "$pair"; done
        emit hook "$hook"
        emit config.remote "$remote"
        emit config.base "$(detect_base)"
        emit config.integration "$(cfg integration)"
        emit config.release "$(cfg release)"
        emit config.protected "$(protected_list)"
        emit config.messagePattern "$(cfg messagePattern)"
        emit config.forbidTrailers "$(cfg forbidTrailers)"
        emit config.mergeStrategy "$(cfg mergeStrategy)"
        emit config.branchPrefix "$(cfg branchPrefix)"
        emit config.releasePattern "$(cfg releasePattern)"
        emit config.upgradeCommand "$(cfg upgradeCommand)"
        emit suggest.release "$(release_branch_name 2>/dev/null || true)"
        emit config.set "$([[ -n "$(cfg integration)" && -n "$(cfg release)" ]] && echo 1 || echo 0)"
        return 0
    fi

    info "repository: ${C_BLD}${REPO_NAME}${C_OFF} ($REPO_ROOT)"
    if [[ -z "$branch" ]]; then
        info "branch:     (detached HEAD at $(git rev-parse --short HEAD))"
        return 0
    fi
    info "branch:     ${C_BLD}${branch}${C_OFF}$( ((is_protected)) && printf '  %s(protected)%s' "$C_YEL" "$C_OFF")"
    [[ -z "$op" ]] || info "waiting:    a $op, to be finished  (git shuttle continue | abort)"
    if [[ -n "$upstream" ]]; then
        info "upstream:   $upstream  (ahead $up_ahead, behind $up_behind)"
    else
        info "upstream:   none (not pushed yet)"
    fi
    info "tree:       $staged staged, $unstaged unstaged, $untracked untracked"
    if [[ -n "$into" ]]; then
        info "vs $remote/$into:  ahead $into_ahead, behind $into_behind (as of the last fetch)"
        (( merged )) && info "merged:     yes, $branch is already in $remote/$into"
    fi
    return 0
}
