# shellcheck shell=bash
# git shuttle continue | abort — finish or give up the rebase, merge or cherry-pick that stopped on a conflict

cmd_continue() {
    need_repo
    local op files file marked=()
    op=$(operation_in_progress)
    [[ -n "$op" ]] || die "nothing is waiting to be finished"

    files=$(unmerged_files)
    # A file that still has conflict markers is not resolved: adding it would commit the markers.
    while IFS= read -r file; do
        [[ -n "$file" ]] || continue
        if [[ -f "$file" ]] && grep -qE '^(<<<<<<< |=======$|>>>>>>> )' -- "$file"; then marked+=("$file"); fi
    done <<<"$files"
    if (( ${#marked[@]} )); then
        printf '%serror:%s these files still have conflict markers (<<<<<<<, =======, >>>>>>>):\n' "$C_RED" "$C_OFF" >&2
        printf '  %s\n' "${marked[@]}" >&2
        exit "$EX_REFUSED"
    fi

    info "continue the $op"
    [[ -z "$files" ]] || info "mark as resolved: ${files//$'\n'/ }"
    confirm "Continue the $op?"
    if [[ -n "$files" ]]; then
        while IFS= read -r file; do [[ -n "$file" ]] && { run git add -- "$file" || die "cannot add $file"; }; done <<<"$files"
    fi
    case "$op" in
        rebase)      run env GIT_EDITOR=true git rebase --continue || stop "the rebase stopped again: resolve the next conflict, then  git shuttle continue" ;;
        merge)       run git commit --no-edit || die "cannot finish the merge" ;;
        cherry-pick) run env GIT_EDITOR=true git cherry-pick --continue || stop "the cherry-pick stopped again: resolve the next conflict, then  git shuttle continue" ;;
    esac
    step "done. Run  git shuttle ship  again (without a message) to go on with what is left."
}

cmd_abort() {
    need_repo
    local op; op=$(operation_in_progress)
    [[ -n "$op" ]] || die "nothing is waiting to be finished"
    info "give up the $op: the repository goes back to how it was before it started"
    confirm "Abort the $op?"
    case "$op" in
        rebase)      run git rebase --abort || die "cannot abort the rebase" ;;
        merge)       run git merge --abort || die "cannot abort the merge" ;;
        cherry-pick) run git cherry-pick --abort || die "cannot abort the cherry-pick" ;;
    esac
    step "aborted"
}
