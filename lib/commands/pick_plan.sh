# shellcheck shell=bash
# The plan of a pick: the commits of a release, in order, where the picking stands, and what is to be done when it is over.
#
# While the picking is not finished the plan lives in the git folder, so that a conflict in the third commit of seven does not make the
# other four be forgotten: `git shuttle continue` finishes the commit that stopped, goes on with the rest and, if --push was asked, pushes
# at the end. `git shuttle abort` forgets it. The file is made of key=value lines (branch, base, strategy, push, mode, current), then one
# commit=SHA for each commit, then one result=NUMBER:SHA for each commit that was picked.

PICK_BRANCH=""; PICK_BASE=""; PICK_STRATEGY=""; PICK_PUSH=0; PICK_MODE=""; PICK_CURRENT=0
PICK_COMMITS=()

pick_plan_file() { printf '%s/shuttle-pick' "$(git rev-parse --absolute-git-dir)"; }
pick_done_file() { printf '%s/shuttle-pick-done' "$(git rev-parse --absolute-git-dir)"; }

# pick_plan_start BRANCH BASE STRATEGY PUSH MODE COMMIT... — the plan of a pick that is about to start. MODE is pick (a new release branch,
# BASE is the release branch it starts from) or cherry-pick (onto a branch that exists). Not written in a dry run.
pick_plan_start() {
    PICK_BRANCH=$1; PICK_BASE=$2; PICK_STRATEGY=$3; PICK_PUSH=$4; PICK_MODE=$5; PICK_CURRENT=0
    shift 5
    PICK_COMMITS=("$@")
    (( DRY_RUN )) && return 0
    {
        printf 'branch=%s\nbase=%s\nstrategy=%s\npush=%s\nmode=%s\ncurrent=0\n' "$PICK_BRANCH" "$PICK_BASE" "$PICK_STRATEGY" "$PICK_PUSH" "$PICK_MODE"
        printf 'commit=%s\n' "$@"
    } > "$(pick_plan_file)"
    rm -f "$(pick_done_file)"
}

# pick_plan_load — reads the plan into the PICK_ variables; false when there is none, or when it is not readable.
pick_plan_load() {
    local file key value
    file=$(pick_plan_file)
    [[ -f "$file" ]] || return 1
    PICK_BRANCH=""; PICK_BASE=""; PICK_STRATEGY=""; PICK_PUSH=0; PICK_MODE=""; PICK_CURRENT=0; PICK_COMMITS=()
    while IFS='=' read -r key value; do
        case "$key" in
            branch)   PICK_BRANCH=$value ;;
            base)     PICK_BASE=$value ;;
            strategy) PICK_STRATEGY=$value ;;
            push)     PICK_PUSH=$value ;;
            mode)     PICK_MODE=$value ;;
            current)  PICK_CURRENT=$value ;;
            commit)   PICK_COMMITS+=("$value") ;;
        esac
    done < "$file"
    (( ${#PICK_COMMITS[@]} )) || return 1
    [[ "$PICK_CURRENT" =~ ^[0-9]+$ && "$PICK_PUSH" =~ ^[01]$ ]] || return 1
}

# pick_plan_matches — the plan loaded is the one of the cherry-pick that waits: the same branch, and the commit that stopped is the one it names.
pick_plan_matches() {
    local sha
    (( PICK_CURRENT >= 1 && PICK_CURRENT <= ${#PICK_COMMITS[@]} )) || return 1
    [[ "$(git symbolic-ref -q --short HEAD 2>/dev/null || true)" == "$PICK_BRANCH" ]] || return 1
    sha=$(git rev-parse -q --verify CHERRY_PICK_HEAD 2>/dev/null) || return 1
    [[ "$sha" == "${PICK_COMMITS[PICK_CURRENT-1]}" ]]
}

pick_plan_set_current() {
    local file
    PICK_CURRENT=$1
    (( DRY_RUN )) && return 0
    file=$(pick_plan_file)
    sed -i.bak "s/^current=.*/current=$1/" "$file" && rm -f "$file.bak"
}

# pick_plan_result NUMBER SHA — the commit that the picking of commit NUMBER made.
pick_plan_result() {
    (( DRY_RUN )) && return 0
    printf 'result=%s:%s\n' "$1" "$2" >> "$(pick_plan_file)"
}

pick_plan_clear() { rm -f "$(pick_plan_file)"; }

# pick_stop NUMBER SHA — the pick stops on a conflict in this commit (exits).
pick_stop() {
    local number=$1 sha=$2 total=${#PICK_COMMITS[@]} rest=() text
    rest=("${PICK_COMMITS[@]:$number}")
    text="commit $number of $total, $(git log -1 --format='%h %s' "$sha"), hit a conflict (you are on '$PICK_BRANCH').
  Resolve the files (git shuttle resolve, or your editor), then  git shuttle continue
  It finishes this commit and picks the rest, in order${PICK_STRATEGY:+, with --strategy-option $PICK_STRATEGY}${PICK_PUSH:+$([[ $PICK_PUSH == 1 ]] && printf ', and pushes the branch at the end')}."
    if (( ${#rest[@]} )); then text="$text
  Still to pick after it: ${rest[*]}"; fi
    text="$text
  or give up with         git shuttle abort"
    stop "$text"
}

# pick_run FIRST — picks the commits of the plan from the number FIRST on (1 is the first), and stops at a conflict. When all are picked:
# the summary, and the push if it was asked.
pick_run() {
    local first=$1 i sha args=() total=${#PICK_COMMITS[@]} remote
    remote=$(cfg_remote)
    [[ -z "$PICK_STRATEGY" ]] || args+=("--strategy-option=$PICK_STRATEGY")
    for (( i = first; i <= total; i++ )); do
        sha=${PICK_COMMITS[i-1]}
        pick_plan_set_current "$i"
        if ! run git cherry-pick "${args[@]}" "$sha"; then
            if [[ -n "$(unmerged_files)" ]]; then pick_stop "$i" "$sha"; fi
            if [[ "$PICK_MODE" == pick ]]; then
                info "  $(git log -1 --format='%h' "$sha") is already in $remote/$PICK_BASE: skipped."
            else
                info "  $(git log -1 --format='%h' "$sha") would change nothing here: skipped."
            fi
            run git cherry-pick --skip || die "cannot skip the empty commit; run  git shuttle abort"
        fi
        pick_plan_result "$i" "$(git rev-parse HEAD 2>/dev/null || true)"
    done
    pick_finish
}

# pick_finish — all the commits of the plan are picked: say so, push if it was asked, and remember the release branch that is ready
# (status --porcelain reports it, so that the page can offer the pull request).
pick_finish() {
    local remote total=${#PICK_COMMITS[@]}
    remote=$(cfg_remote)
    if [[ "$PICK_MODE" == pick ]]; then
        step "'$PICK_BRANCH' is ready: $(git rev-list --count "$remote/$PICK_BASE..HEAD") commit(s) on top of $remote/$PICK_BASE"
        git log --oneline "$remote/$PICK_BASE..HEAD"
    else
        step "'$PICK_BRANCH' now has $total more commit(s)"
    fi
    if (( ! DRY_RUN )); then
        if [[ "$PICK_MODE" == pick ]]; then
            printf 'branch=%s\nbase=%s\npushed=%s\n' "$PICK_BRANCH" "$PICK_BASE" "$PICK_PUSH" > "$(pick_done_file)"
        fi
        pick_plan_clear
    fi
    if (( PICK_PUSH )); then
        push_branch "$PICK_BRANCH" 0
    elif [[ "$PICK_MODE" == pick ]]; then
        info "Push it with:  git shuttle push --allow-protected   (or  git push -u $remote $PICK_BRANCH)"
    fi
}
