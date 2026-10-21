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
    base=${base:-$INTEGRATION}
    [[ "$branch" != "$base" ]] || die "'$branch' is the base of the pull request"
    local gh=${GIT_SHUTTLE_GH:-gh}
    command -v "$gh" >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed (see its documentation to install it)"

    if [[ -z "$title" ]]; then title=$(git log -1 --format=%s); fi
    [[ -n "$title" ]] || die "no title: pass --title"

    show_where "$branch"
    info "pull request: $branch -> $base"
    info "title:        $title"
    confirm "Push '$branch' and open the pull request?"
    push_branch "$branch" 0

    local args=(pr create --base "$base" --head "$branch" --title "$title")
    if [[ -n "$body_file" ]]; then args+=(--body-file "$body_file")
    else args+=(--body "$body"); fi
    (( draft )) && args+=(--draft)
    run "$gh" "${args[@]}" || stop "gh could not open the pull request (is one already open for '$branch'? are you logged in: gh auth status)."
    step "pull request opened"
}
