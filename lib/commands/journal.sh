# shellcheck shell=bash
# git shuttle journal | undo | redo — what was changed, and taking it back
#
# Undo and redo only work on what git-shuttle itself did, and only when they are safe:
#   * every branch and tag is still where the change left it, and so is HEAD and the stash;
#   * no branch has to move away from commits that are on a remote (pushed history is never rewritten);
#   * the working tree has no uncommitted changes to tracked files.
# Otherwise they say exactly why not, and change nothing.

journal_summary() { # PRE POST
    local ref pre post out=""
    local -A seen=()
    while IFS= read -r ref; do
        [[ -n "$ref" && -z "${seen[$ref]:-}" ]] || continue
        seen[$ref]=1
        pre=$(snapshot_get "$1" "ref:$ref"); post=$(snapshot_get "$2" "ref:$ref")
        [[ "$pre" != "$post" ]] || continue
        if [[ -z "$pre" ]]; then out+="${out:+, }+${ref#refs/*/}"
        elif [[ -z "$post" ]]; then out+="${out:+, }-${ref#refs/*/}"
        else out+="${out:+, }${ref#refs/*/} ${pre:0:7}..${post:0:7}"; fi
    done < <(snapshot_refs "$1"; snapshot_refs "$2")
    [[ "$(snapshot_get "$1" stash)" == "$(snapshot_get "$2" stash)" ]] || out+="${out:+, }stash $(snapshot_get "$1" stash)..$(snapshot_get "$2" stash)"
    [[ "$(snapshot_get "$1" branch)" == "$(snapshot_get "$2" branch)" ]] || out+="${out:+, }HEAD ${1:+$(snapshot_get "$1" branch)}->$(snapshot_get "$2" branch)"
    printf '%s' "${out:-nothing}"
}

cmd_journal() {
    local porcelain=0 limit=20
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            --limit) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || die "--limit needs a number"; limit=$2; shift 2 ;;
            *) die "journal: unknown argument '$1'" ;;
        esac
    done
    need_repo
    local file; file=$(journal_file)
    local id time command state pre post
    if [[ ! -f "$file" ]]; then (( porcelain )) || info "nothing has been journaled yet"; return 0; fi
    while IFS=$'\t' read -r id time command state pre post; do
        if (( porcelain )); then printf '%s\x1f%s\x1f%s\x1f%s\x1f%s\0' "$id" "$time" "$command" "$state" "$(journal_summary "$pre" "$post")"
        else printf '%4s  %s  %-9s %-7s %s\n' "$id" "$time" "$state" "$command" "$(journal_summary "$pre" "$post")"; fi
    done < <(tail -n "$limit" "$file" | sort -t$'\t' -k1,1nr)
}

# journal_step undo|redo — shared by both
journal_step() {
    local way=$1 entry id time command state pre post from to
    need_repo
    refuse_operation
    if [[ "$way" == undo ]]; then entry=$(journal_entry "done"); else entry=$(journal_entry undone); fi
    [[ -n "$entry" ]] || die "nothing to $way"
    IFS=$'\t' read -r id time command state pre post <<<"$entry"
    if [[ "$way" == undo ]]; then from=$post; to=$pre; else from=$pre; to=$post; fi

    local problems
    problems=$(restore_problems "$from" "$to")
    case "$way $command" in
        "undo stash pop"|"undo stash apply") problems+=$'\n'"the stash was applied to your working tree: that is not undone (stash the changes again if you want it)" ;;
        "redo stash pop"|"redo stash apply") problems+=$'\n'"redo of a stash is not offered: apply it again" ;;
    esac
    [[ "$command" =~ ^(commit|amend)$ && "$way" == undo ]] || [[ -z "$(git diff HEAD --name-only 2>/dev/null)" ]] || problems+=$'\n'"you have uncommitted changes to tracked files: commit or stash them first"
    problems=$(printf '%s' "$problems" | sed '/^$/d')
    if [[ -n "$problems" ]]; then
        printf '%serror:%s cannot %s %s (%s):\n' "$C_RED" "$C_OFF" "$way" "$command" "$time" >&2
        printf '  - %s\n' "${problems//$'\n'/$'\n'  - }" | sed 's/^  - \(  - \)/  - /' >&2
        exit "$EX_REFUSED"
    fi

    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "$way: $command ($time)  $(journal_summary "$pre" "$post")"
    confirm "${way^} it?"
    # a stash that was pushed is brought back, one that was dropped is put back in the list
    local from_stash to_stash
    from_stash=$(snapshot_get "$from" stash); to_stash=$(snapshot_get "$to" stash)
    if (( to_stash < from_stash )) && [[ "$(snapshot_get "$to" stashtop)" != "$(snapshot_get "$from" stashtop)" ]] && (( to_stash + 1 == from_stash )); then
        run git stash pop -q || die "cannot take the stash back out"
    elif (( to_stash > from_stash )) && [[ -n "$(snapshot_get "$to" stashtop)" ]]; then
        run git stash store -m "restored by git shuttle $way" "$(snapshot_get "$to" stashtop)" || die "cannot put the stash back"
    fi
    local keep=0
    [[ "$way" == undo && "$command" =~ ^(commit|amend)$ ]] && keep=1
    restore_state "$from" "$to" "$keep" || stop "the $way stopped half way: look at  git status  and  git shuttle journal"
    if (( ! DRY_RUN )); then
        journal_mark "$id" "$([[ "$way" == undo ]] && echo undone || echo "done")"
    fi
    step "$way done: $command"
}

cmd_undo() { journal_step undo; }
cmd_redo() { journal_step redo; }
