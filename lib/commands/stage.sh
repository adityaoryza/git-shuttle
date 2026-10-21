# shellcheck shell=bash
# git shuttle stage PATH... — git add for the files you name (new files need it before a commit)

cmd_stage() {
    local paths=()
    while (( $# )); do
        case "$1" in
            --) shift; paths+=("$@"); break ;;
            -*) die "stage: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done
    (( ${#paths[@]} )) || die "stage needs the paths:  git shuttle stage -- file other/file"
    need_repo
    refuse_operation
    [[ -n "$(git status --porcelain -- "${paths[@]}")" ]] || die "nothing to stage in: ${paths[*]}"
    run git add -- "${paths[@]}" || die "git add failed"
}
