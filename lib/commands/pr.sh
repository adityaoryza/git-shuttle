# shellcheck shell=bash
# git shuttle pr [--base BRANCH] [--title TEXT] [--body-file FILE | --body TEXT] [--draft]
#
# Pushes the branch if needed and opens a pull request with the GitHub CLI (gh): to the integration branch by default.

cmd_pr() {
    local base="" title="" body="" body_file="" draft=0
    while (( $# )); do
        case "$1" in
            --base)      [[ $# -ge 2 ]] || die "--base needs a branch"; base=$2; shift 2 ;;
            --title)     [[ $# -ge 2 ]] || die "--title needs a text"; title=$2; shift 2 ;;
            --body)      [[ $# -ge 2 ]] || die "--body needs a text"; body=$2; shift 2 ;;
            --body-file) [[ $# -ge 2 ]] || die "--body-file needs a file"; body_file=$2; shift 2 ;;
            --draft)     draft=1; shift ;;
            *) die "pr: unknown argument '$1'" ;;
        esac
    done
    [[ -z "$body" || -z "$body_file" ]] || die "give the description with --body or with --body-file, not both"
    [[ -z "$body_file" || -f "$body_file" ]] || die "the description file '$body_file' does not exist"

    need_repo
    refuse_operation
    need_branch
    local branch=$BRANCH
    refuse_protected "$branch" "open a pull request"
    load_branches
    base=${base:-$(reference_branch "$branch")}
    [[ "$branch" != "$base" ]] || die "'$branch' is the base of the pull request"
    local gh=${GIT_SHUTTLE_GH:-gh}
    command -v "$gh" >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed: install it (brew install gh, winget install GitHub.cli, or your package manager) and run  gh auth login ; or push the branch and open the pull request on the hosting site"

    # the add-on of the task this branch is for may propose the title and the description (what is typed always wins)
    local ref_addon from_addon=""
    ref_addon=$(git config --get "branch.$branch.shuttle-ref-addon" 2>/dev/null || true)
    if [[ -n "$ref_addon" && ( -z "$title" || ( -z "$body" && -z "$body_file" ) ) ]] && addon_usable "$ref_addon" pr; then
        local commits
        commits=$(git log --reverse --format='%h %s' -n 50 "origin/$base..$branch" 2>/dev/null || git log --reverse --format='%h %s' -n 50 "$base..$branch" 2>/dev/null || true)
        if addon_hook "$ref_addon" pr "repo.root=$REPO_ROOT" "repo.name=$REPO_NAME" "branch=$branch" "base=$base" "commits=$commits" \
            "ref-id=$(git config --get "branch.$branch.shuttle-ref-id" 2>/dev/null || true)" \
            "ref-title=$(git config --get "branch.$branch.shuttle-ref-title" 2>/dev/null || true)" \
            "ref-link=$(git config --get "branch.$branch.shuttle-ref-link" 2>/dev/null || true)"; then
            [[ -n "$title" ]] || title=$(addon_rec title)
            if [[ -z "$body" && -z "$body_file" ]]; then body=$(addon_rec body); fi
            from_addon=$ref_addon
        else
            warn "the add-on '$ref_addon' gave no pull request text: $ADDON_PROBLEM"
        fi
        addon_cleanup
    fi
    if [[ -z "$title" ]]; then title=$(git log -1 --format=%s); fi
    [[ -n "$title" ]] || die "no title: pass --title"

    show_where "$branch"
    info "pull request: $branch -> $base"
    info "title:        $title"
    [[ -z "$from_addon" || -z "$body" ]] || info "description:  from the add-on '$from_addon' ($(printf '%s' "$body" | wc -l | tr -d ' ') lines)"
    confirm "Push '$branch' and open the pull request?"
    push_branch "$branch" 0

    local args=(pr create --base "$base" --head "$branch" --title "$title")
    if [[ -n "$body_file" ]]; then args+=(--body-file "$body_file")
    else args+=(--body "$body"); fi
    (( draft )) && args+=(--draft)
    run "$gh" "${args[@]}" || stop "gh could not open the pull request (is one already open for '$branch'? are you logged in: gh auth status)."
    # the address of the pull request, when gh can say it (best effort: it is only for the trace)
    if (( ! DRY_RUN )) && [[ -n "$(git config --get "branch.$branch.shuttle-ref-id" 2>/dev/null)" ]]; then
        trace_event pr "$branch" "base=$base" "title=$title" "url=$("$gh" pr view "$branch" --json url --jq .url 2>/dev/null | head -n1)"
    fi
    step "pull request opened"
    task_report_after_pr "$branch" "$base" "$title"
}
