# shellcheck shell=bash
# git shuttle unstage -- PATH... — take files out of the next commit; their changes stay in the working tree

cmd_unstage() {
    local paths=()
    while (( $# )); do
        case "$1" in
            --) shift; paths+=("$@"); break ;;
            -*) die "unstage: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done
    (( ${#paths[@]} )) || die "unstage needs the paths:  git shuttle unstage -- file other/file"
    need_repo
    refuse_operation
    [[ -n "$(git diff --cached --name-only -- "${paths[@]}")" ]] || die "nothing is staged in: ${paths[*]}"
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "unstage: ${paths[*]}"
    confirm "Unstage ${#paths[@]} path(s)?"
    if git rev-parse -q --verify HEAD >/dev/null; then
        run git restore --staged -- "${paths[@]}" || die "git restore failed"
    else
        run git rm -r -q --cached -- "${paths[@]}" || die "git rm --cached failed"      # a repository without a first commit
    fi
}
