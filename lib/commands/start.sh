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
    local name="" from="" mode="" owner
    local addon_args=()      # name, flag, value of the flags that an enabled add-on declared (--task 15607)
    while (( $# )); do
        case "$1" in
            --from) [[ $# -ge 2 ]] || die "--from needs a branch"; from=$2; shift 2 ;;
            --stash|--carry)
                [[ -z "$mode" || "$mode" == "${1#--}" ]] || die "start: --stash and --carry cannot be used together"
                mode=${1#--}; shift ;;
            -*) owner=$(addon_flag_owner start "$1")
                [[ -n "$owner" ]] || die "start: unknown option '$1'"
                [[ $# -ge 2 ]] || die "start: $1 needs a value (it is an option of the add-on '$owner')"
                addon_args+=("$owner" "${1#--}" "$2"); shift 2 ;;
            *) [[ -z "$name" ]] || die "start: give the name as one argument, in quotes"; name=$1; shift ;;
        esac
    done
    [[ -n "$name" || ${#addon_args[@]} -gt 0 ]] || die "start needs a name:  git shuttle start \"keep manual order date\""
    need_repo
    refuse_operation
    [[ -n "$mode" ]] || require_clean_tree
    load_branches
    local ref_addon="" ref_id="" ref_title="" ref_link="" ref_trace=() detail_line
    if (( ${#addon_args[@]} )); then
        # what the add-on knows (the task): its answer is checked, and a name it proposes is used only when none was given
        local i hook_name hook_args
        for (( i = 0; i < ${#addon_args[@]}; i += 3 )); do
            hook_name=${addon_args[i]}
            hook_args=("arg.${addon_args[i+1]}=${addon_args[i+2]}" "repo.root=$REPO_ROOT" "repo.name=$REPO_NAME" "repo.branch_prefix=$(cfg branchPrefix)")
            addon_hook "$hook_name" start "${hook_args[@]}" || die "the add-on '$hook_name': $ADDON_PROBLEM"
            [[ -n "$name" ]] || name=$(addon_rec branch)
            if [[ -z "$ref_id" ]]; then
                ref_addon=$hook_name; ref_id=$(addon_rec ref-id); ref_title=$(addon_rec ref-title); ref_link=$(addon_rec ref-link)
                # what the add-on knows of the task today (the stage, the project...): kept in the trace of the task, with the date
                while IFS= read -r detail_line; do
                    [[ -n "$detail_line" ]] && ref_trace+=("d.${detail_line%%$'\x1f'*}=${detail_line#*$'\x1f'}")
                done < <(addon_rec_all ref-detail)
            fi
            [[ -z "$(addon_rec note)" ]] || info "$hook_name: $(addon_rec note)"
            addon_cleanup
        done
        [[ -n "$name" ]] || die "the add-on gave no branch name: give one:  git shuttle start \"keep manual order date\" ${addon_args[1]:+--${addon_args[1]} ${addon_args[2]}}"
        [[ -z "$ref_id" ]] || info "for:        $ref_addon #$ref_id${ref_title:+  $ref_title}"
    fi

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
    if [[ -n "$ref_id" ]] && ! (( DRY_RUN )); then
        # the branch remembers what it is for: the pull request, the cards of the page and the release notes read it
        git config "branch.$branch.shuttle-ref-addon" "$ref_addon"
        git config "branch.$branch.shuttle-ref-id" "$ref_id"
        [[ -z "$ref_title" ]] || git config "branch.$branch.shuttle-ref-title" "$ref_title"
        [[ -z "$ref_link" ]] || git config "branch.$branch.shuttle-ref-link" "$ref_link"
        trace_event start "$branch" "from=$remote/$from" "sha=$(trace_sha HEAD)" "${ref_trace[@]}"
    fi
    step "on '$branch', cut from $remote/$from"
    (( stashed )) && info "your changes are in the stash ('git stash list'); bring them back with: git stash pop"
    (( changes && ! stashed )) && [[ "$mode" == carry ]] && info "your uncommitted changes came along"
    return 0
}
