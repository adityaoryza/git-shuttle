# shellcheck shell=bash
# git shuttle ship [-m MESSAGE] [-- PATH...] [--no-sync] [--force-with-lease]
#
# Commit, then everything merge does, after one question. Without -m it ships the commits the branch already has.

cmd_ship() {
    local message="" merge_args=() commit_args=() paths=() pr=0 pr_args=()
    while (( $# )); do
        case "$1" in
            -m|--message) [[ $# -ge 2 ]] || die "$1 needs a message"; message=$2; shift 2 ;;
            --pr) pr=1; shift ;;
            --title|--body|--body-file|--base) [[ $# -ge 2 ]] || die "$1 needs a value"; pr_args+=("$1" "$2"); shift 2 ;;
            --draft) pr_args+=("$1"); shift ;;
            --no-sync|--force-with-lease) merge_args+=("$1"); shift ;;
            --into) [[ $# -ge 2 ]] || die "--into needs a branch"; merge_args+=("$1" "$2"); shift 2 ;;
            --allow-protected) die "ship never works on a protected branch" ;;
            --) shift; paths=("$@"); break ;;
            -*) die "ship: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done

    need_repo
    refuse_operation
    need_branch
    local branch=$BRANCH
    refuse_protected "$branch" "ship"
    load_branches

    # Everything that can be refused is refused now, before the first change.
    if [[ -n "$message" ]]; then
        local problem; problem=$(message_problem "$message")
        [[ -z "$problem" ]] || die "$problem"
        if (( ${#paths[@]} )); then
            [[ -n "$(git status --porcelain -- "${paths[@]}")" ]] || die "nothing to commit in: ${paths[*]} (new files need  git add  first)"
        else
            git diff --cached --quiet && die "nothing is staged: git add the files first, or name the paths"
        fi
    elif (( ${#paths[@]} )); then
        die "paths only make sense with -m"
    fi
    require_clean_tree_unless_committing "$message"
    (( pr )) || (( ${#pr_args[@]} == 0 )) || die "--title, --body, --body-file, --base and --draft go with --pr"
    (( pr )) && (( ${#merge_args[@]} )) && die "--pr opens a pull request: it does not take the merge options"

    show_where "$branch"
    [[ -z "$message" ]] || info "commit:     $message"
    if (( pr )); then
        info "then:       sync on $INTEGRATION, push, open a pull request"
    else
        info "then:       ship to ${merge_args[1]:-$INTEGRATION} (sync, push, merge, push, back)"
    fi
    confirm "Commit and ship '$branch'?"
    # shellcheck disable=SC2034  # read by confirm() in lib/core.sh
    YES=1   # asked once: the steps below do not ask again
    # shellcheck disable=SC2034  # read by require_clean_tree() in lib/git.sh
    (( DRY_RUN )) && [[ -n "$message" ]] && ASSUME_COMMITTED=1

    if [[ -n "$message" ]]; then
        commit_args=(-m "$message")
        (( ${#paths[@]} )) && commit_args+=(-- "${paths[@]}")
        cmd_commit "${commit_args[@]}"
    fi
    if (( pr )); then
        fetch_remote
        sync_branch "$branch" "$INTEGRATION"
        cmd_pr "${pr_args[@]}"
    else
        cmd_merge "${merge_args[@]}"
    fi
}

# require_clean_tree_unless_committing MESSAGE — with a message the staged files are about to be committed; without one
# the tree must already be clean.
require_clean_tree_unless_committing() {
    [[ -n "$1" ]] && return 0
    require_clean_tree
}
