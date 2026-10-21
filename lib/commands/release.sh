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

cmd_release() {
    local args=() item hashes h seen=" " auto_name
    need_repo
    load_branches
    while (( $# )); do
        case "$1" in
            --onto)
                [[ $# -ge 2 ]] || die "$1 needs a value"
                if [[ "$2" == auto ]]; then
                    auto_name=$(release_branch_name) || exit 1
                    args+=("$1" "$auto_name")
                else
                    args+=("$1" "$2")
                fi
                shift 2 ;;
            --from|-X|--strategy-option)
                [[ $# -ge 2 ]] || die "$1 needs a value"; args+=("$1" "$2"); shift 2 ;;
            --push) args+=("$1"); shift ;;
            -*) die "release: unknown option '$1'" ;;
            *)
                item=$1; shift
                if branch_tip "$item" >/dev/null 2>&1; then
                    hashes=$(branch_commits "$item") || exit 1   # a name that is a branch wins over a short hash
                else
                    hashes=$item
                fi
                [[ -n "$hashes" ]] || die "'$item' has no commits to pick"
                for h in $hashes; do
                    [[ "$seen" == *" $h "* ]] || { args+=("$h"); seen="$seen$h "; }
                done
                ;;
        esac
    done
    cmd_pick "${args[@]}"
}
