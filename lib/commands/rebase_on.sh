# shellcheck shell=bash
# git shuttle rebase-on BRANCH — replay the branch you are on on top of another branch
#
# Not on a protected branch, not with uncommitted changes. It says how many commits are replayed, and warns when the branch is
# already pushed (the next push then needs --force-with-lease).

cmd_rebase_on() {
    local other=""
    while (( $# )); do
        case "$1" in
            -*) die "rebase-on: unknown option '$1'" ;;
            *) [[ -z "$other" ]] || die "rebase-on: give one branch"; other=$1; shift ;;
        esac
    done
    [[ -n "$other" ]] || die "rebase-on needs a branch:  git shuttle rebase-on origin/staging"
    need_repo
    refuse_operation
    need_commit "$other"
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "rebase-on"
    require_clean_tree
    [[ "$other" != "$branch" ]] || die "that is the branch you are on"
    if git merge-base --is-ancestor "$COMMIT" HEAD; then info "'$branch' already contains $other: nothing to rebase."; return 0; fi
    local replay; replay=$(git rev-list --count "$COMMIT..HEAD")
    show_where "$branch"
    info "rebase:     '$branch' on top of $other"
    info "replays:    $replay commit(s) ($(git rev-list --count "HEAD..$COMMIT") new under them)"
    [[ -z "$(upstream_of "$branch")" ]] || warn "'$branch' has an upstream: if its commits were pushed, the rebase rewrites them and the next push needs  git shuttle push --force-with-lease"
    confirm "Rebase '$branch' on '$other'?"
    run git rebase "$other" || stop "the rebase on $other hit a conflict.
  Resolve the files, then  git shuttle continue
  or give up with         git shuttle abort"
    step "'$branch' is on top of $other"
}
