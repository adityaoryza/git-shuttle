# shellcheck shell=bash
# git shuttle discard [--staged] [--untracked] -- PATH... — throw changes away (this cannot be undone)
#
#   (default)    the changes in the working tree of tracked files; what is staged stays staged
#   --staged     also what is staged: the files go back to how the last commit has them
#   --untracked  also delete the untracked files you name (files only: never folders, never ignored files)

cmd_discard() {
    local paths=() staged=0 untracked=0
    while (( $# )); do
        case "$1" in
            --staged) staged=1; shift ;;
            --untracked) untracked=1; shift ;;
            --) shift; paths+=("$@"); break ;;
            -*) die "discard: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done
    (( ${#paths[@]} )) || die "discard needs the paths:  git shuttle discard -- file other/file"
    need_repo
    refuse_operation
    git rev-parse -q --verify HEAD >/dev/null || die "discard needs a first commit: there is nothing to go back to"

    local tracked_changes new_files
    if (( staged )); then tracked_changes=$(git diff HEAD --name-only -- "${paths[@]}"); else tracked_changes=$(git diff --name-only -- "${paths[@]}"); fi
    new_files=$(git ls-files --others --exclude-standard -- "${paths[@]}")
    (( untracked )) || new_files=""
    [[ -n "$tracked_changes" || -n "$new_files" ]] || die "nothing to discard in: ${paths[*]}"

    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    warn "these changes are lost for good:"
    [[ -z "$tracked_changes" ]] || printf '%s\n' "$tracked_changes" | sed 's/^/  changed  /'
    [[ -z "$new_files" ]] || printf '%s\n' "$new_files" | sed 's/^/  deleted  /'
    confirm "Discard them?"
    if [[ -n "$tracked_changes" ]]; then
        if (( staged )); then
            run git restore --source=HEAD --staged --worktree -- "${paths[@]}" || die "git restore failed"
        else
            run git restore -- "${paths[@]}" || die "git restore failed"
        fi
    fi
    if [[ -n "$new_files" ]]; then
        run git clean -f -q -- "${paths[@]}" || die "git clean failed"
    fi
}
