# shellcheck shell=bash
# git shuttle candidates [--porcelain] — the branches merged into the integration branch that a release does not have yet
#
# Read from the merge commits of the integration branch since the release branch. A branch merged by fast-forward or squash
# leaves no merge commit: it is not listed (pick its commits by hash).

# candidates_records — prints "<merge>\x1f<date>\x1f<subject>" for each merge, then "\x1f<hash>\x1f<+|-> \x1f<subject>" per commit.
cmd_candidates() {
    local porcelain=0
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            *) die "candidates: unknown argument '$1'" ;;
        esac
    done
    need_repo
    load_branches
    local remote integration release m date subject line mark hash
    remote=$(cfg_remote)
    integration="refs/remotes/$remote/$INTEGRATION"; release="refs/remotes/$remote/$RELEASE"
    have_ref "$integration" || die "the branch '$INTEGRATION' does not exist on '$remote' (git fetch first?)"
    have_ref "$release" || die "the branch '$RELEASE' does not exist on '$remote' (git fetch first?)"

    local found=0
    while IFS=$'\x1f' read -r m date subject; do
        [[ -n "$m" ]] || continue
        found=1
        if (( porcelain )); then
            printf 'candidate=%s\x1f%s\x1f%s\0' "$m" "$date" "$subject"
        else
            info "$(git rev-parse --short "$m")  $date  $subject"
        fi
        # '+' = the commit is not in the release branch (by patch), '-' = an equivalent is already there
        while read -r mark hash; do
            [[ -n "$hash" ]] || continue
            line=$(git log -1 --format=%s "$hash")
            if (( porcelain )); then
                printf 'commit=%s\x1f%s\x1f%s\x1f%s\0' "$m" "$hash" "$mark" "$line"
            else
                info "    $mark $(git rev-parse --short "$hash") $line"
            fi
        done < <(git cherry "$release" "$m^2" "$m^1" 2>/dev/null | while read -r mk hs; do git merge-base --is-ancestor "$hs" "$m^2" 2>/dev/null && echo "$mk $hs"; done | tac)
    done < <(git log --merges --first-parent --format='%H%x1f%cI%x1f%s' "$release..$integration")
    (( found )) || { (( porcelain )) || info "no branch was merged into $INTEGRATION since $RELEASE."; }
    return 0
}
