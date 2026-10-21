# shellcheck shell=bash
# git shuttle rewrite BASE ACTION:COMMIT... [--message COMMIT=TEXT]... [--allow-pushed]
#   Replay the commits after BASE (oldest first, as given) with a plan. ACTION is pick, reword, squash, fixup or drop.
#   squash melts a commit into the one before it and keeps both messages; fixup keeps only the message of the one before.
#   --message gives the new message of a commit that is picked (it makes that a reword).
# git shuttle drop COMMIT          take one commit out of the branch
# git shuttle move COMMIT up|down  swap a commit with its neighbour
#
# Every commit between BASE and the branch tip must be in the plan, once, and the range may not contain merge commits. History that is
# on a remote is not rewritten unless --allow-pushed is given. Not on a protected branch, not with uncommitted changes.

# rewrite_run BASE ALLOW_PUSHED PLAN... — PLAN items are "action:fullsha"; messages are in the REWRITE_MESSAGES array (sha => text).
rewrite_run() {
    local base=$1 allow=$2; shift 2
    local plan=("$@")
    local branch; need_branch; branch=$BRANCH
    refuse_protected "$branch" "rewrite history"
    refuse_operation
    require_clean_tree
    local range="$base..HEAD" listed expected item action sha seen=() first=1 dir todo msgn=0
    expected=$(git rev-list --reverse "$range")
    [[ -n "$expected" ]] || die "there are no commits after that base"
    [[ -z "$(git rev-list --merges "$range")" ]] || die "the range has a merge commit: only straight history can be rewritten"
    listed=""
    for item in "${plan[@]}"; do
        action=${item%%:*}; sha=${item#*:}
        case "$action" in pick|reword|squash|fixup|drop) ;; *) die "'$action' is not an action (pick, reword, squash, fixup, drop)" ;; esac
        [[ " ${seen[*]:-} " != *" $sha "* ]] || die "the commit ${sha:0:7} is in the plan twice"
        seen+=("$sha")
        grep -qx "$sha" <<<"$expected" || die "the commit ${sha:0:7} is not between the base and '$branch'"
        if [[ "$action" != drop && $first == 1 ]]; then
            [[ "$action" != squash && "$action" != fixup ]] || die "the first commit kept cannot be squashed or fixed up: there is nothing before it"
            first=0
        fi
        listed+="$sha"$'\n'
    done
    [[ "$(sort <<<"$expected")" == "$(printf '%s' "$listed" | sort)" ]] || die "the plan must name every commit after the base, once each"

    refuse_pushed "$range" "rewriting" "$allow"
    show_where "$branch"
    info "plan:       replay $(wc -l <<<"$expected" | tr -d ' ') commit(s) after $(git log -1 --format='%h %s' "$base")"
    for item in "${plan[@]}"; do
        action=${item%%:*}; sha=${item#*:}
        info "  $(printf '%-7s' "$action") $(git log -1 --format='%h %s' "$sha")"
        [[ -z "${REWRITE_MESSAGES[$sha]:-}" ]] || info "          new message: ${REWRITE_MESSAGES[$sha]%%$'\n'*}"
    done
    confirm "Rewrite '$branch'?"
    (( DRY_RUN )) && return 0

    dir=$(mktemp -d "${TMPDIR:-/tmp}/shuttle-rewrite.XXXXXX") || die "cannot make a temporary folder"
    todo="$dir/todo"
    for item in "${plan[@]}"; do
        action=${item%%:*}; sha=${item#*:}
        if [[ -n "${REWRITE_MESSAGES[$sha]:-}" ]]; then
            msgn=$((msgn + 1)); printf '%s\n' "${REWRITE_MESSAGES[$sha]}" > "$dir/message-$msgn"
            printf 'pick %s\nexec git commit --amend --only -q -F %s\n' "$sha" "$dir/message-$msgn" >> "$todo"
        else
            printf '%s %s\n' "$action" "$sha" >> "$todo"
        fi
    done
    local before; before=$(git rev-parse HEAD)
    run env GIT_SEQUENCE_EDITOR="cp $todo" GIT_EDITOR=true git rebase -q -i "$base" || {
        if [[ -n "$(operation_in_progress)" ]]; then
            stop "the rewrite stopped: resolve the files, then  git shuttle continue  (or give up with  git shuttle abort)"
        fi
        rm -rf "$dir"
        die "cannot rewrite"
    }
    rm -rf "$dir"
    step "'$branch' rewritten ($(git rev-list --count "$base..HEAD") commit(s) after the base, was $(git rev-list --count "$base..$before"))"
}

cmd_rewrite() {
    local base="" allow=0 plan=() msg_sha msg_text
    declare -gA REWRITE_MESSAGES=()
    while (( $# )); do
        case "$1" in
            --allow-pushed) allow=1; shift ;;
            --message)
                [[ $# -ge 2 && "$2" == *=* ]] || die "--message needs COMMIT=TEXT"
                msg_sha=${2%%=*}; msg_text=${2#*=}
                [[ -n "$msg_text" ]] || die "a new message cannot be empty"
                need_repo; need_commit "$msg_sha"
                REWRITE_MESSAGES[$COMMIT]=$msg_text; shift 2 ;;
            -*) die "rewrite: unknown option '$1'" ;;
            *) if [[ -z "$base" ]]; then base=$1; else plan+=("$1"); fi; shift ;;
        esac
    done
    [[ -n "$base" && ${#plan[@]} -gt 0 ]] || die "rewrite needs a base and a plan:  git shuttle rewrite <base> pick:<commit> drop:<commit> ..."
    need_repo
    need_commit "$base"; base=$COMMIT
    local item action sha full=() problem
    for item in "${plan[@]}"; do
        [[ "$item" == *:* ]] || die "'$item' is not ACTION:COMMIT"
        action=${item%%:*}; sha=${item#*:}
        need_commit "$sha"
        full+=("$action:$COMMIT")
        if [[ -n "${REWRITE_MESSAGES[$COMMIT]:-}" ]]; then
            [[ "$action" == pick || "$action" == reword ]] || die "only a picked commit takes a new message"
            problem=$(message_problem "${REWRITE_MESSAGES[$COMMIT]}")
            [[ -z "$problem" ]] || die "$problem"
        elif [[ "$action" == reword ]]; then
            die "reword needs the new message:  --message ${sha:0:7}=\"...\""
        fi
    done
    rewrite_run "$base" "$allow" "${full[@]}"
}

# rewrite_plan_all BASE — the plan "pick:sha" for every commit after BASE, oldest first, one per line.
rewrite_plan_all() { git rev-list --reverse "$1..HEAD" | sed 's/^/pick:/'; }

cmd_drop() {
    local target="" allow=0
    while (( $# )); do
        case "$1" in
            --allow-pushed) allow=1; shift ;;
            -*) die "drop: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "drop: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$target" ]] || die "drop needs a commit:  git shuttle drop <commit>"
    need_repo
    need_commit "$target"; target=$COMMIT
    git merge-base --is-ancestor "$target" HEAD || die "that commit is not on the branch you are on"
    git rev-parse -q --verify "$target^" >/dev/null || die "the first commit of the history cannot be dropped"
    declare -gA REWRITE_MESSAGES=()
    local plan=() line
    while IFS= read -r line; do
        [[ "$line" == "pick:$target" ]] && line="drop:$target"
        plan+=("$line")
    done < <(rewrite_plan_all "$target^")
    rewrite_run "$target^" "$allow" "${plan[@]}"
}

cmd_move() {
    local target="" way="" allow=0
    while (( $# )); do
        case "$1" in
            --allow-pushed) allow=1; shift ;;
            up|down) way=$1; shift ;;
            -*) die "move: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "move: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$target" && -n "$way" ]] || die "move needs a commit and a direction:  git shuttle move <commit> up|down"
    need_repo
    need_commit "$target"; target=$COMMIT
    git merge-base --is-ancestor "$target" HEAD || die "that commit is not on the branch you are on"
    git rev-parse -q --verify "$target^" >/dev/null || die "the first commit of the history cannot be moved"
    # "up" is towards the tip of the branch (newer), as in the log; "down" towards older commits
    local base=$target^ other
    local list=()
    if [[ "$way" == up ]]; then
        other=$(git rev-list --reverse --ancestry-path "$target..HEAD" | head -n 1)
        [[ -n "$other" ]] || die "that commit is already the newest"
    else
        other=$(git rev-parse "$target^")
        git rev-parse -q --verify "$other^" >/dev/null || die "that commit is already the oldest"
        base=$other^
    fi
    declare -gA REWRITE_MESSAGES=()
    local first="" second="" item
    if [[ "$way" == up ]]; then first=$other; second=$target; else first=$target; second=$other; fi
    while IFS= read -r item; do list+=("$item"); done < <(rewrite_plan_all "$base")
    # put the swapped pair where the first of them stood
    local out=() placed=0
    for item in "${list[@]}"; do
        case "$item" in
            "pick:$target"|"pick:$other")
                if (( ! placed )); then out+=("pick:$first" "pick:$second"); placed=1; fi ;;
            *) out+=("$item") ;;
        esac
    done
    rewrite_run "$base" "$allow" "${out[@]}"
}
