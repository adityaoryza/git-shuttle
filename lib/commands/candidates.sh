# shellcheck shell=bash
# git shuttle candidates [--porcelain] — the branches merged into the integration branch that a release does not have yet
#
# Read from the merge commits of the integration branch since the release branch. A branch merged by fast-forward or squash
# leaves no merge commit: it is not listed (pick its commits by hash).

# open_release_refs REMOTE RELEASE_REF — the release branches that are not in the release branch yet (made with shuttle.releasePattern), newest first
open_release_refs() {
    local remote=$1 release=$2 pattern glob ref
    pattern=$(cfg releasePattern); pattern=${pattern:-release/\{date\}-v1.\{n\}}
    glob=${pattern//\{date\}/\*}; glob=${glob//\{yymmdd\}/\*}; glob=${glob//\{n\}/\*}
    while read -r ref; do
        [[ -n "$ref" && "$ref" != "$release" ]] || continue
        git merge-base --is-ancestor "$ref" "$release" 2>/dev/null && continue    # its commits are in the release branch: they show as released
        printf '%s\n' "$ref"
    done < <(git for-each-ref --sort=-creatordate --format='%(refname)' "refs/remotes/$remote/$glob" 2>/dev/null | head -5)
}

# candidates_records — prints "<merge>\x1f<date>\x1f<subject>" for each merge, then "\x1f<hash>\x1f<+|-|~> \x1f<subject>\x1f<release branch>" per commit.
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

    # '~' = not in the release branch, but in a release branch that is on its way (a pull request that is not merged yet)
    local -A queued=()
    local ref name
    while read -r ref; do
        [[ -n "$ref" ]] || continue
        name=${ref#"refs/remotes/$remote/"}
        while read -r mark hash; do
            [[ "$mark" == "-" && -n "${hash:-}" && -z "${queued[$hash]:-}" ]] && queued[$hash]=$name
        done < <(git cherry "$ref" "$integration" "$release" 2>/dev/null)
    done < <(open_release_refs "$remote" "$release")

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
            name=""
            if [[ "$mark" == "+" && -n "${queued[$hash]:-}" ]]; then mark="~"; name=${queued[$hash]}; fi
            if (( porcelain )); then
                printf 'commit=%s\x1f%s\x1f%s\x1f%s\x1f%s\0' "$m" "$hash" "$mark" "$line" "$name"
            else
                info "    $mark $(git rev-parse --short "$hash") $line${name:+  (in $name)}"
            fi
        done < <(git cherry "$release" "$m^2" "$m^1" 2>/dev/null | while read -r mk hs; do git merge-base --is-ancestor "$hs" "$m^2" 2>/dev/null && echo "$mk $hs"; done | tac)
    done < <(git log --merges --first-parent --format='%H%x1f%cI%x1f%s' "$release..$integration")
    (( found )) || { (( porcelain )) || info "no branch was merged into $INTEGRATION since $RELEASE."; }
    return 0
}
