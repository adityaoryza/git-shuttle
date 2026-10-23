# shellcheck shell=bash
# git shuttle continue | abort — finish or give up the rebase, merge, cherry-pick, revert or patch that stopped on a conflict
#
# A pick that has a plan (pick, cherry-pick and release make one: lib/commands/pick_plan.sh) goes on with the commits that are left once the
# one that stopped is finished, and pushes at the end if that was asked. abort forgets the plan.

cmd_continue() {
    need_repo
    local op files file marked=() planned=0 left
    op=$(operation_in_progress)
    if [[ -z "$op" ]]; then
        # the commit that stopped may have been finished by hand (git cherry-pick --continue): the rest of the pick is still to do
        if pick_plan_load && [[ "$(git symbolic-ref -q --short HEAD 2>/dev/null || true)" == "$PICK_BRANCH" ]] && (( PICK_CURRENT >= 1 )); then
            left=$(( ${#PICK_COMMITS[@]} - PICK_CURRENT ))
            info "the commit that stopped is finished: go on with the pick ($left commit(s) left)"
            confirm "Go on with the pick?"
            if (( left > 0 )); then pick_run $((PICK_CURRENT + 1)); else pick_finish; fi
            return $?
        fi
        die "nothing is waiting to be finished"
    fi
    if [[ "$op" == cherry-pick ]] && pick_plan_load && pick_plan_matches; then planned=1; fi

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
    if (( planned )); then info "this is commit $PICK_CURRENT of ${#PICK_COMMITS[@]} of the pick; $(( ${#PICK_COMMITS[@]} - PICK_CURRENT )) come after it"; fi
    [[ -z "$files" ]] || info "mark as resolved: ${files//$'\n'/ }"
    confirm "Continue the $op?"
    if [[ -n "$files" ]]; then
        while IFS= read -r file; do [[ -n "$file" ]] && { run git add -- "$file" || die "cannot add $file"; }; done <<<"$files"
    fi
    case "$op" in
        rebase)      run env GIT_EDITOR=true git rebase --continue || stop "the rebase stopped again: resolve the next conflict, then  git shuttle continue" ;;
        merge)       run git commit --no-edit || die "cannot finish the merge" ;;
        cherry-pick)
            if (( planned )); then
                if (( DRY_RUN )); then info "(dry run) then the commits after it are picked, in order"; return 0; fi
                if git diff --cached --quiet; then
                    info "nothing is left of this commit after the resolution: it is skipped"
                    run git cherry-pick --skip || stop "cannot skip it: run  git shuttle abort  and start again"
                else
                    run env GIT_EDITOR=true git cherry-pick --continue || stop "the cherry-pick stopped again: resolve the next conflict, then  git shuttle continue"
                    pick_plan_result "$PICK_CURRENT" "$(git rev-parse HEAD)"
                fi
                pick_run $((PICK_CURRENT + 1))
                return $?
            fi
            run env GIT_EDITOR=true git cherry-pick --continue || stop "the cherry-pick stopped again: resolve the next conflict, then  git shuttle continue" ;;
        am)          run git am --continue || stop "the patch stopped again: resolve the files, then  git shuttle continue" ;;
        revert)      run env GIT_EDITOR=true git revert --continue || stop "the revert stopped again: resolve the next conflict, then  git shuttle continue" ;;
    esac
    step "done. Run  git shuttle ship  again (without a message) to go on with what is left."
}

cmd_abort() {
    need_repo
    local op; op=$(operation_in_progress)
    if [[ -z "$op" ]]; then
        # nothing waits, but the plan of a pick may be left behind (the commit that stopped was given up by hand)
        if [[ -f "$(pick_plan_file)" ]]; then pick_plan_clear; info "the plan of the pick was forgotten: nothing else is waiting"; return 0; fi
        die "nothing is waiting to be finished"
    fi
    info "give up the $op: the repository goes back to how it was before it started"
    if [[ "$op" == cherry-pick ]] && pick_plan_load; then
        info "the pick is given up too: the commits that were picked before stay on '$PICK_BRANCH', the $(( ${#PICK_COMMITS[@]} - PICK_CURRENT )) after this one are not picked"
    fi
    confirm "Abort the $op?"
    case "$op" in
        rebase)      run git rebase --abort || die "cannot abort the rebase" ;;
        merge)       run git merge --abort || die "cannot abort the merge" ;;
        cherry-pick) run git cherry-pick --abort || die "cannot abort the cherry-pick" ;;
        am)          run git am --abort || die "cannot abort the patch" ;;
        revert)      run git revert --abort || die "cannot abort the revert" ;;
    esac
    if [[ "$op" == cherry-pick ]] && (( ! DRY_RUN )); then pick_plan_clear; fi
    step "aborted"
}
