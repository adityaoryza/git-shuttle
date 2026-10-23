# shellcheck shell=bash
# git shuttle release --onto NEW [--from BASE] [--strategy-option ours|theirs] [--push] BRANCH_OR_COMMIT...
#
# Like pick, but a branch name stands for the commits it brought: no hashes to look up. A branch that was merged is read from
# its merge commit; one that was not is read from where it leaves the integration branch.

# branch_tip BRANCH — the commit a branch name points to, local first, then the remote's.
branch_tip() {
    local name=$1 remote; remote=$(cfg_remote)
    [[ "$name" != HEAD ]] || return 1       # refs/remotes/<remote>/HEAD is a pointer, not a branch
    if git show-ref -q --verify "refs/heads/$name"; then git rev-parse "refs/heads/$name"
    elif git show-ref -q --verify "refs/remotes/$remote/$name"; then git rev-parse "refs/remotes/$remote/$name"
    else return 1; fi
}

# branch_commits BRANCH — the commits a branch brought, oldest first. Dies when it cannot tell.
branch_commits() {
    local name=$1 tip integration merge m remote
    remote=$(cfg_remote)
    tip=$(branch_tip "$name") || die "'$name' is not a branch"
    integration="$remote/$INTEGRATION"
    have_ref "refs/remotes/$integration" || die "the branch '$INTEGRATION' does not exist on '$remote'"

    if git merge-base --is-ancestor "$tip" "refs/remotes/$integration"; then
        # Already in the integration branch: the merge commit that brought it holds its commits between its two parents.
        merge=""
        while read -r m; do
            [[ -n "$m" ]] || continue
            if git merge-base --is-ancestor "$tip" "$m^2" 2>/dev/null && ! git merge-base --is-ancestor "$tip" "$m^1"; then
                merge=$m; break
            fi
        done < <(git rev-list --merges --first-parent --ancestry-path --reverse "$tip..refs/remotes/$integration")
        [[ -n "$merge" ]] || die "cannot tell which commits '$name' brought into $INTEGRATION (a fast-forward or squash merge?): give its commits explicitly"
        git rev-list --reverse --no-merges "$merge^1..$merge^2"
    else
        git rev-list --reverse --no-merges "refs/remotes/$integration..$tip"
    fi
}

# release_branch_name — the name releasePattern gives, with the first free {n} (a local or remote branch of that name counts as taken).
release_branch_name() {
    local pattern date n=0 name remote default='release/{date}-v1.{n}'
    pattern=$(cfg releasePattern); pattern=${pattern:-$default}
    date=$(date +%Y%m%d)
    remote=$(cfg_remote)
    while :; do
        name=${pattern//\{date\}/$date}
        name=${name//\{yymmdd\}/${date:2}}
        name=${name//\{n\}/$n}
        if git show-ref -q --verify "refs/heads/$name" || git show-ref -q --verify "refs/remotes/$remote/$name"; then
            [[ "$pattern" == *"{n}"* ]] || die "the release branch '$name' already exists"
            n=$((n + 1)); (( n < 100 )) || die "no free name for the release branch (releasePattern: $pattern)"
            continue
        fi
        local parent=$name
        while [[ "$parent" == */* ]]; do
            parent=${parent%/*}
            if git show-ref -q --verify "refs/heads/$parent" || git show-ref -q --verify "refs/remotes/$remote/$parent"; then
                die "cannot name the release branch '$name': a branch called '$parent' exists and git branch names do not nest (change shuttle.releasePattern)"
            fi
        done
        printf '%s' "$name"; return 0
    done
}

# release_empty NAME FROM PUSH — the release branch, cut from the remote release branch, with no commit yet.
release_empty() {
    local onto=$1 from=${2:-$RELEASE} push=$3 remote
    remote=$(cfg_remote)
    refuse_operation
    git check-ref-format --branch "$onto" >/dev/null 2>&1 || die "'$onto' is not a valid branch name"
    require_clean_tree
    git show-ref -q --verify "refs/heads/$onto" && die "the branch '$onto' already exists"
    fetch_remote
    have_ref "refs/remotes/$remote/$from" || die "the branch '$from' does not exist on '$remote' (--from <branch>, or git config shuttle.release <branch>)"
    git show-ref -q --verify "refs/remotes/$remote/$onto" && die "the branch '$onto' already exists on '$remote'"
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "new branch: $onto, from $remote/$from, with no commit yet (add them later with  git shuttle release --onto $onto --append COMMIT...)"
    confirm "Create '$onto'?"
    run git checkout --no-track -b "$onto" "$remote/$from" || die "cannot create '$onto'"
    step "'$onto' is ready, at $remote/$from"
    if (( push )); then push_branch "$onto" 0; else info "Push it with:  git shuttle push --allow-protected   (or  git push -u $remote $onto)"; fi
}

# release_append NAME PUSH COMMIT... — more commits on a release branch that exists: it is checked out and they are picked in order.
release_append() {
    local onto=$1 push=$2; shift 2
    local remote; remote=$(cfg_remote)
    refuse_operation
    git check-ref-format --branch "$onto" >/dev/null 2>&1 || die "'$onto' is not a valid branch name"
    require_clean_tree
    refuse_protected "$onto" "add commits"
    fetch_remote
    if ! git show-ref -q --verify "refs/heads/$onto"; then
        have_ref "refs/remotes/$remote/$onto" || die "there is no release branch '$onto', locally or on '$remote' (create it with  git shuttle release --onto $onto --empty)"
        show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
        info "a local copy of $remote/$onto is made, then the commits are picked onto it"
        confirm "Switch to '$onto' and pick ${#} commit(s)?"
        run git checkout --track -b "$onto" "$remote/$onto" || die "cannot switch to '$onto'"
    else
        local current; current=$(git symbolic-ref -q --short HEAD || true)
        if [[ "$current" != "$onto" ]]; then
            show_where "${current:-(detached)}"
            confirm "Switch to '$onto' and pick ${#} commit(s)?"
            run git checkout "$onto" || die "cannot switch to '$onto'"
        fi
    fi
    if (( DRY_RUN )); then
        info "(dry run) then: git shuttle cherry-pick $*${push:+$([[ $push == 1 ]] && printf ', and push the branch')}"
        return 0
    fi
    # --push goes with the plan: it is done when the last commit is picked, also after a conflict that was resolved on the way
    if (( push )); then cmd_cherry_pick --push "$@" || return $?; else cmd_cherry_pick "$@" || return $?; fi
}

cmd_release() {
    local args=() item hashes h seen=" " auto_name empty=0 append=0 onto="" from="" push=0 commits=() traced=()
    need_repo
    load_branches
    while (( $# )); do
        case "$1" in
            --onto)
                [[ $# -ge 2 ]] || die "$1 needs a value"
                if [[ "$2" == auto ]]; then
                    auto_name=$(release_branch_name) || exit 1
                    onto=$auto_name
                    args+=("$1" "$auto_name")
                else
                    onto=$2
                    args+=("$1" "$2")
                fi
                shift 2 ;;
            --empty) empty=1; shift ;;
            --append) append=1; shift ;;
            --from|-X|--strategy-option)
                [[ $# -ge 2 ]] || die "$1 needs a value"
                [[ "$1" != --from ]] || from=$2
                args+=("$1" "$2"); shift 2 ;;
            --push) push=1; args+=("$1"); shift ;;
            -*) die "release: unknown option '$1'" ;;
            *)
                item=$1; shift
                if branch_tip "$item" >/dev/null 2>&1; then
                    traced+=("$item")                            # (the task of a branch, if it has one, is told that it is in this release)
                    hashes=$(branch_commits "$item") || exit 1   # a name that is a branch wins over a short hash
                else
                    hashes=$item
                fi
                [[ -n "$hashes" ]] || die "'$item' has no commits to pick"
                for h in $hashes; do
                    [[ "$seen" == *" $h "* ]] || { args+=("$h"); commits+=("$h"); seen="$seen$h "; }
                done
                ;;
        esac
    done
    (( ! empty || ! append )) || die "release: --empty and --append do not go together"
    if (( empty )); then
        [[ -n "$onto" ]] || die "release --empty needs the new branch:  git shuttle release --onto auto --empty"
        (( ${#commits[@]} == 0 )) || die "release --empty makes a branch with no commit: leave the commits out, or use --append later"
        release_empty "$onto" "$from" "$push"
        return
    fi
    if (( append )); then
        [[ -n "$onto" ]] || die "release --append needs the release branch:  git shuttle release --onto <branch> --append COMMIT..."
        (( ${#commits[@]} )) || die "release --append needs at least one commit"
        release_append "$onto" "$push" "${commits[@]}" || return $?
        release_trace "$onto" "${traced[@]}"
        return 0
    fi
    cmd_pick "${args[@]}" || return $?
    release_trace "$onto" "${traced[@]}"
}

# release_trace RELEASE_BRANCH BRANCH... — each branch that is for a task puts "released" in the trace of its task.
release_trace() {
    local onto=$1 b
    shift
    for b in "$@"; do
        trace_event release "$b" "release_branch=$onto" "sha=$(trace_sha "$b")"
    done
    return 0
}
