# shellcheck shell=bash
# git shuttle patch create COMMIT [--to FILE]   a patch (mbox, with author and message) for one commit, on standard output or in FILE
# git shuttle patch apply FILE                  apply a patch file as a commit (git am); on a conflict: continue or abort
#
# A patch file is limited to 5 MB. Nothing is applied on a protected branch, with uncommitted changes, or part way through another operation.

PATCH_LIMIT=5242880

cmd_patch() {
    local sub=${1:-}; shift || true
    need_repo
    case "$sub" in
        create) patch_create "$@" ;;
        apply) patch_apply "$@" ;;
        *) die "patch: create or apply" ;;
    esac
}

patch_create() {
    local target="" to=""
    while (( $# )); do
        case "$1" in
            --to) [[ $# -ge 2 ]] || die "--to needs a file"; to=$2; shift 2 ;;
            -*) die "patch create: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "patch create: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$target" ]] || die "patch create needs a commit"
    need_commit "$target"
    is_merge_commit "$COMMIT" && die "a merge commit has no single patch"
    if [[ -z "$to" ]]; then git format-patch -1 --stdout "$COMMIT"; return 0; fi
    [[ ! -e "$to" ]] || die "'$to' exists already"
    [[ -d "$(dirname "$to")" ]] || die "the folder of '$to' does not exist"
    git format-patch -1 --stdout "$COMMIT" > "$to" || die "cannot write the patch"
    step "patch in $to"
}

patch_apply() {
    local file=${1:-}
    [[ -n "$file" && $# -eq 1 ]] || die "patch apply needs one file"
    [[ -f "$file" ]] || die "'$file' is not a file"
    (( $(wc -c < "$file") <= PATCH_LIMIT )) || die "the patch is larger than 5 MB"
    refuse_operation
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "apply a patch"
    require_clean_tree
    git apply --check -- "$file" 2>/dev/null || info "note: it does not apply cleanly; git am will stop to let you resolve it"
    show_where "$branch"
    info "patch:      $file"
    confirm "Apply it on '$branch'?"
    local before; before=$(git rev-parse HEAD)
    run git am --3way --keep-non-patch -- "$file" || stop "the patch did not apply cleanly.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
    [[ "$(git rev-parse HEAD)" != "$before" ]] || die "nothing to apply: the changes of the patch are already there"
    step "applied"
}
