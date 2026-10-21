# shellcheck shell=bash
# git shuttle start NAME [--from BRANCH] [--stash | --carry] — a branch for a new piece of work, cut from the remote integration branch
#
# The name is turned into snake_case and given the prefix of shuttle.branchPrefix (default "feature/"):
#   git shuttle start "Keep manual order date"   ->   feature/keep_manual_order_date
#
# Uncommitted changes to tracked files stop the command, unless you say what to do with them:
#   --stash   put them in the stash first (named after both branches); new files stay where they are
#   --carry   take them along to the new branch; git refuses, and nothing changes, when they conflict

# branch_slug TEXT — lower case, words joined by underscores, nothing else.
branch_slug() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//'
}

cmd_start() {
    local name="" from="" mode=""
    while (( $# )); do
        case "$1" in
            --from) [[ $# -ge 2 ]] || die "--from needs a branch"; from=$2; shift 2 ;;
            --stash|--carry)
                [[ -z "$mode" || "$mode" == "${1#--}" ]] || die "start: --stash and --carry cannot be used together"
                mode=${1#--}; shift ;;
            -*) die "start: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "start: give the name as one argument, in quotes"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" ]] || die "start needs a name:  git shuttle start \"keep manual order date\""
    need_repo
    refuse_operation
    [[ -n "$mode" ]] || require_clean_tree
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
    local current changes=0
    current=$(git symbolic-ref -q --short HEAD || echo '(detached)')
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then changes=1; fi

    show_where "$current"
    info "new branch: $branch, from $remote/$from"
    if (( changes )); then
        case "$mode" in
            stash) info "your uncommitted changes: put in the stash first (new files stay where they are)" ;;
            carry) info "your uncommitted changes: taken along to '$branch'" ;;
        esac
    fi
    confirm "Create '$branch'?"
    fetch_remote
    have_ref "refs/remotes/$remote/$from" || die "the branch '$from' does not exist on '$remote'"
    git show-ref -q --verify "refs/remotes/$remote/$branch" && die "the branch '$branch' already exists on '$remote'"

    local stashed=0
    if [[ "$mode" == stash ]] && (( changes )); then
        run git stash push -m "git-shuttle: changes of '$current' before starting '$branch'" || die "cannot stash your changes: nothing was changed"
        stashed=1
    fi
    if ! run git checkout --no-track -b "$branch" "$remote/$from"; then
        if (( stashed )); then
            run git stash pop >/dev/null 2>&1 || warn "your changes are still in the stash: git stash pop"
            die "cannot create '$branch': your changes were put back"
        fi
        if [[ "$mode" == carry ]]; then
            die "cannot create '$branch': your uncommitted changes conflict with $remote/$from; nothing was changed (use --stash, or commit them first)"
        fi
        die "cannot create '$branch'"
    fi
    step "on '$branch', cut from $remote/$from"
    (( stashed )) && info "your changes are in the stash ('git stash list'); bring them back with: git stash pop"
    (( changes && ! stashed )) && [[ "$mode" == carry ]] && info "your uncommitted changes came along"
    return 0
}
