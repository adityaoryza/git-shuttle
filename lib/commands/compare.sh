# shellcheck shell=bash
# git shuttle compare A [B] [--porcelain] — what is in B and not in A, and the other way round (read only)
#
# B defaults to the branch you are on. The porcelain output is NUL separated key=value records: ahead, behind, then one `ahead-commit`
# or `behind-commit` per commit (id, subject) and `file` per changed file (status, path).

cmd_compare() {
    local a="" b="" porcelain=0
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            -*) die "compare: unknown option '$1'" ;;
            *) if [[ -z "$a" ]]; then a=$1; elif [[ -z "$b" ]]; then b=$1; else die "compare: at most two names"; fi; shift ;;
        esac
    done
    [[ -n "$a" ]] || die "compare needs a branch or commit:  git shuttle compare origin/staging"
    need_repo
    b=${b:-HEAD}
    need_commit "$a"; local ca=$COMMIT
    need_commit "$b"; local cb=$COMMIT
    local ahead behind
    ahead=$(git rev-list --count "$ca..$cb"); behind=$(git rev-list --count "$cb..$ca")
    if (( porcelain )); then
        printf 'ahead=%s\0behind=%s\0' "$ahead" "$behind"
        git log --format='ahead-commit=%h%x1f%s' "$ca..$cb" | tr '\n' '\0'
        git log --format='behind-commit=%h%x1f%s' "$cb..$ca" | tr '\n' '\0'
        local st old new path
        while IFS= read -r -d '' st; do
            case "$st" in
                R*|C*) IFS= read -r -d '' old; IFS= read -r -d '' new; printf 'file=%s\x1f%s\x1f%s\0' "${st:0:1}" "$new" "$old" ;;
                *) IFS= read -r -d '' path; printf 'file=%s\x1f%s\0' "$st" "$path" ;;
            esac
        done < <(git diff --name-status -z "$ca...$cb")
        return 0
    fi
    info "$b is $ahead commit(s) ahead of $a and $behind behind"
    (( ahead == 0 )) || { info "ahead:"; git log --format='  %h %s' "$ca..$cb"; }
    (( behind == 0 )) || { info "behind:"; git log --format='  %h %s' "$cb..$ca"; }
    info "files changed in $b since the common ancestor:"
    git diff --stat "$ca...$cb" | sed 's/^/  /'
}
