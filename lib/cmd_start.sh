# shellcheck shell=bash
# git shuttle start NAME [--from BRANCH] — a branch for a new piece of work, cut from the remote integration branch
#
# The name is turned into snake_case and given the prefix of shuttle.branchPrefix (default "feature/"):
#   git shuttle start "Keep manual order date"   ->   feature/keep_manual_order_date

# branch_slug TEXT — lower case, words joined by underscores, nothing else.
branch_slug() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//'
}

cmd_start() {
    local name="" from=""
    while (( $# )); do
        case "$1" in
            --from) [[ $# -ge 2 ]] || die "--from needs a branch"; from=$2; shift 2 ;;
            -*) die "start: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "start: give the name as one argument, in quotes"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "start needs a name:  git shuttle start \"keep manual order date\""
    need_repo
    refuse_operation
    require_clean_tree
    load_branches

    local prefix slug branch remote
    prefix=$(cfg branchPrefix); prefix=${prefix:-feature/}
    slug=$(branch_slug "${name#"$prefix"}")
    [[ -n "$slug" ]] || die "the name '$name' has no letters or digits"
    branch="$prefix$slug"
    git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "'$branch' is not a valid branch name"
    from=${from:-$INTEGRATION}
    remote=$(cfg_remote)

    git show-ref -q --verify "refs/heads/$branch" && die "the branch '$branch' already exists"
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "new branch: $branch, from $remote/$from"
    confirm "Create '$branch'?"
    fetch_remote
    have_ref "refs/remotes/$remote/$from" || die "the branch '$from' does not exist on '$remote'"
    git show-ref -q --verify "refs/remotes/$remote/$branch" && die "the branch '$branch' already exists on '$remote'"
    run git checkout --no-track -b "$branch" "$remote/$from" || die "cannot create '$branch'"
    step "on '$branch', cut from $remote/$from"
}
