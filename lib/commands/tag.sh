# shellcheck shell=bash
# git shuttle tag NAME [COMMIT] [-m MESSAGE] [--push] | untag NAME [--remote] — a tag on a commit (annotated when it has a message)

cmd_tag() {
    local name="" target="HEAD" message="" push=0 positional=0
    while (( $# )); do
        case "$1" in
            -m) [[ $# -ge 2 ]] || die "-m needs the message"; message=$2; shift 2 ;;
            --push) push=1; shift ;;
            -*) die "tag: unknown option '$1'" ;;
            *) (( positional == 0 )) && name=$1 || target=$1; positional=$((positional + 1)); shift ;;
        esac
    done
    [[ -n "$name" ]] || die "tag needs a name:  git shuttle tag v1.2 [commit]"
    need_repo
    if [[ "$name" == -* ]] || ! git check-ref-format "refs/tags/$name"; then die "'$name' is not a valid tag name"; fi
    git show-ref -q --verify "refs/tags/$name" && die "a tag called '$name' already exists"
    need_commit "$target"
    local remote; remote=$(cfg_remote)
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "tag:        $name on $(git log -1 --format='%h %s' "$COMMIT")$([[ -n "$message" ]] && echo " (annotated)")"
    confirm "Create the tag?"
    if [[ -n "$message" ]]; then run git tag -a "$name" -m "$message" "$COMMIT" || die "cannot tag"
    else run git tag "$name" "$COMMIT" || die "cannot tag"; fi
    if (( push )); then run git push "$remote" "refs/tags/$name" || stop "the tag '$name' exists here but could not be pushed"; fi
    step "tag $name"
}

cmd_untag() {
    local name="" remote_too=0
    while (( $# )); do
        case "$1" in
            --remote) remote_too=1; shift ;;
            -*) die "untag: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "untag: give one tag"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "untag needs a name:  git shuttle untag v1.2"
    need_repo
    git show-ref -q --verify "refs/tags/$name" || die "there is no tag '$name'"
    local remote; remote=$(cfg_remote)
    info "delete the tag $name$( (( remote_too )) && echo " here and on $remote")"
    confirm "Delete the tag?"
    run git tag -d "$name" || die "cannot delete"
    if (( remote_too )); then run git push "$remote" --delete "refs/tags/$name" || warn "the tag could not be deleted on $remote"; fi
    step "tag $name deleted"
}
