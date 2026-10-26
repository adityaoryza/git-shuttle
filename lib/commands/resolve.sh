# shellcheck shell=bash
# git shuttle resolve --ours|--theirs -- PATH...           in a conflict, keep one whole side of a file
# git shuttle resolve --hunk N=CHOICE... -- FILE           or choose place by place (see  git shuttle conflicts FILE)
#
# --ours and --theirs mean what git means by them, and git-shuttle says which branch each one is: in a merge, a cherry-pick or a revert
# "ours" is the branch you are on; in a REBASE it is the other way round: "ours" is what you rebase onto, "theirs" is your own work.
# A side that deleted the file keeps it deleted. What the other side wrote in these files is dropped (git checkout --merge -- FILE brings
# the conflict back). The files are staged as resolved; then  git shuttle continue.
#
# --hunk N=ours|theirs|both|both-reverse|base takes, for place number N of ONE file: what "ours" has, what "theirs" has, both (ours first),
# both (theirs first), or what both started from (only for a file written in the diff3 style). N=pick:o1+t2+o3 takes lines one by one: the lines
# of ours (o), of theirs (t) or of what both started from (b), numbered from 1, written in the order given (pick: alone takes the place out of the
# file). The places not named keep their markers, and the file is staged only when none is left.
# PATH is as `git shuttle status` lists the conflicts (from the top of the repository).

# conflict_sides — what git calls "ours" and "theirs" in the operation that waits, in words. Sets SIDE_OURS, SIDE_OURS_ROLE, SIDE_THEIRS
# and SIDE_THEIRS_ROLE (all empty when nothing waits). The web page shows them next to every file in conflict.
# shellcheck disable=SC2034  # read by cmd_resolve and by status --porcelain
conflict_sides() {
    SIDE_OURS=""; SIDE_OURS_ROLE=""; SIDE_THEIRS=""; SIDE_THEIRS_ROLE=""
    local op gd head onto="" dir sha
    op=$(operation_in_progress)
    [[ -n "$op" ]] || return 0
    gd=$(git rev-parse --git-dir)
    head=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)
    case "$op" in
        rebase)
            for dir in rebase-merge rebase-apply; do
                if [[ -f "$gd/$dir/head-name" ]]; then
                    head=$(sed 's#^refs/heads/##' "$gd/$dir/head-name")
                    onto=$(cat "$gd/$dir/onto" 2>/dev/null || true)
                    break
                fi
            done
            SIDE_OURS=$(conflict_ref_label "$onto" "the branch you rebase onto"); SIDE_OURS_ROLE="what you rebase onto"
            SIDE_THEIRS=${head:-"your commits"}; SIDE_THEIRS_ROLE="your own work, being replayed" ;;
        merge)
            SIDE_OURS=${head:-HEAD}; SIDE_OURS_ROLE="the branch you are on"
            sha=$(git rev-parse -q --verify MERGE_HEAD || true)
            SIDE_THEIRS=$(conflict_ref_label "$sha" "the other branch"); SIDE_THEIRS_ROLE="the branch you merge in" ;;
        cherry-pick|revert)
            SIDE_OURS=${head:-HEAD}; SIDE_OURS_ROLE="the branch you are on"
            if [[ "$op" == revert ]]; then sha=$(git rev-parse -q --verify REVERT_HEAD || true); else sha=$(git rev-parse -q --verify CHERRY_PICK_HEAD || true); fi
            if [[ -n "$sha" ]]; then SIDE_THEIRS="$(git rev-parse --short "$sha") $(git log -1 --format=%s "$sha" | cut -c1-60)"; else SIDE_THEIRS="the commit"; fi
            if [[ "$op" == revert ]]; then SIDE_THEIRS="the undoing of $SIDE_THEIRS"; SIDE_THEIRS_ROLE="the commit being undone"; else SIDE_THEIRS_ROLE="the commit you pick"; fi ;;
        am)
            SIDE_OURS=${head:-HEAD}; SIDE_OURS_ROLE="the branch you are on"
            SIDE_THEIRS="the patch"; SIDE_THEIRS_ROLE="the patch you apply" ;;
    esac
}

# conflict_ref_label COMMIT FALLBACK — the name of a branch that points at the commit (a local one first), else its short hash;
# FALLBACK when there is no commit.
conflict_ref_label() {
    local name
    [[ -n "$1" ]] || { printf '%s' "$2"; return 0; }
    name=$(git for-each-ref --points-at "$1" --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null | grep -v '/HEAD$' | head -n 1 || true)
    printf '%s' "${name:-$(git rev-parse --short "$1")}"
}

# resolve_hunks FILE SPEC... — place by place: SPEC is N=ours|theirs|both|both-reverse|base.
resolve_hunks() {
    local file=$1 spec n choice choices="" total left ours_tmp out_tmp picked po pt pb msg
    local shape='^([1-9][0-9]{0,3})=(ours|theirs|both|both-reverse|base|pick:([otb][1-9][0-9]{0,3}(\+[otb][1-9][0-9]{0,3})*)?)$'
    shift
    for spec in "$@"; do
        if (( ${#spec} > 20000 )) || [[ ! "$spec" =~ $shape ]]; then
            die "resolve: '${spec:0:60}' is not  N=ours|theirs|both|both-reverse|base|pick:o1+t2"
        fi
        n=${BASH_REMATCH[1]}
        [[ ",$choices," != *",$n="* ]] || die "resolve: place $n is given twice"
        choices+="${choices:+,}$n=${BASH_REMATCH[2]}"
    done
    [[ -f "$file" ]] || die "'$file' is not in the working tree: it has no places to choose from (it was deleted on one side: keep a side with --ours or --theirs)"
    (( $(wc -c < "$file") <= CONFLICT_MAX_BYTES )) || die "'$file' is too big to be resolved place by place: keep a whole side"
    ours_tmp=$(mktemp); out_tmp=$(mktemp)
    git show ":2:$file" > "$ours_tmp" 2>/dev/null || : > "$ours_tmp"
    total=$(awk -v mode=count "$CONFLICT_AWK" "$ours_tmp" "$file")
    if (( total == 0 )); then rm -f "$ours_tmp" "$out_tmp"; die "'$file' has no conflict markers: edit it, or keep a whole side with --ours or --theirs"; fi

    for spec in "$@"; do
        n=${spec%%=*}
        if (( n > total )); then rm -f "$ours_tmp" "$out_tmp"; die "'$file' has $total place(s) in conflict: there is no place $n"; fi
    done

    # the choices are tried on a copy first, also in a dry run: a line that does not exist is refused here, before anything is written
    if ! msg=$(awk -v mode=apply -v choices="$choices" "$CONFLICT_AWK" "$ours_tmp" "$file" 2>&1 >"$out_tmp"); then
        rm -f "$ours_tmp" "$out_tmp"; die "${msg:-cannot write the choices}: nothing was changed"
    fi

    conflict_sides
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "operation:  $(operation_in_progress)"
    info "file:       $file ($total place(s) in conflict)"
    for spec in "$@"; do
        n=${spec%%=*}; choice=${spec#*=}
        case "$choice" in
            ours)         info "  place $n: keep $SIDE_OURS ($SIDE_OURS_ROLE)" ;;
            theirs)       info "  place $n: keep $SIDE_THEIRS ($SIDE_THEIRS_ROLE)" ;;
            both)         info "  place $n: keep both, $SIDE_OURS first" ;;
            both-reverse) info "  place $n: keep both, $SIDE_THEIRS first" ;;
            base)         info "  place $n: go back to what both started from" ;;
            pick:*)       picked=${choice#pick:}; po=${picked//[^o]/}; pt=${picked//[^t]/}; pb=${picked//[^b]/}
                          info "  place $n: line by line: ${#po} line(s) of $SIDE_OURS, ${#pt} of $SIDE_THEIRS${pb:+, ${#pb} of what both started from}$(if [[ -n $picked ]]; then echo " (in this order: $picked)"; else echo ": nothing, the place is taken out"; fi)" ;;
        esac
    done
    if (( $# < total )); then info "  the other $(( total - $# )) place(s) keep their markers: the file is not marked as resolved yet"; fi
    confirm "Write this into $file?"
    if (( DRY_RUN )); then rm -f "$ours_tmp" "$out_tmp"; info "(dry run) nothing was changed"; return 0; fi

    cat "$out_tmp" > "$file"
    left=$(awk -v mode=count "$CONFLICT_AWK" "$ours_tmp" "$file")
    rm -f "$ours_tmp" "$out_tmp"
    if (( left == 0 )); then
        run git add -- "$file" || die "cannot mark the file as resolved"
        step "$file is resolved ($# place(s) written)"
        info "to take it back:  git checkout --merge -- $file"
    else
        step "$# place(s) written; $left still in conflict in $file"
    fi
    if [[ -z "$(unmerged_files)" ]]; then info "next:  git shuttle continue"; else info "next:  resolve what is left, then  git shuttle continue"; fi
}

cmd_resolve() {
    local side="" paths=() hunks=()
    while (( $# )); do
        case "$1" in
            --ours|--theirs)
                [[ -z "$side" || "$side" == "${1#--}" ]] || die "resolve: give --ours or --theirs, not both"
                side=${1#--}; shift ;;
            --hunk) [[ $# -ge 2 ]] || die "--hunk needs N=ours|theirs|both|both-reverse|base"; hunks+=("$2"); shift 2 ;;
            --) shift; paths+=("$@"); break ;;
            -*) die "resolve: unknown option '$1'" ;;
            *)  paths+=("$1"); shift ;;
        esac
    done
    if (( ${#hunks[@]} )); then
        [[ -z "$side" ]] || die "resolve: choose place by place (--hunk) or a whole side (--ours, --theirs), not both"
        (( ${#paths[@]} == 1 )) || die "resolve --hunk takes one file:  git shuttle resolve --hunk 1=theirs -- FILE"
    else
        [[ -n "$side" ]] || die "resolve needs a side:  git shuttle resolve --ours -- FILE   (or --theirs, or  --hunk 1=ours -- FILE)"
        (( ${#paths[@]} )) || die "resolve needs the files:  git shuttle resolve --theirs -- file other/file"
    fi
    need_repo
    [[ -n "$(operation_in_progress)" ]] || die "nothing is waiting: there is no conflict to resolve"
    cd "$REPO_ROOT" || die "cannot enter $REPO_ROOT"
    # the names are files, never patterns (the same as the web page asks for)
    local GIT_LITERAL_PATHSPECS=1; export GIT_LITERAL_PATHSPECS

    local unmerged file
    unmerged=$(unmerged_files)
    for file in "${paths[@]}"; do
        if [[ -z "$file" ]] || ! grep -Fxq -- "$file" <<<"$unmerged"; then die "'$file' is not in conflict (git shuttle status lists the files that are)"; fi
    done
    if (( ${#hunks[@]} )); then resolve_hunks "${paths[0]}" "${hunks[@]}"; return $?; fi

    # the side a file does not have (it deleted it) is kept by deleting the file
    local stage=3; [[ "$side" == ours ]] && stage=2
    local -a keep=() delete=()
    for file in "${paths[@]}"; do
        if git ls-files -u -- "$file" | awk -v s="$stage" '$3 == s { found = 1 } END { exit !found }'; then keep+=("$file"); else delete+=("$file"); fi
    done

    conflict_sides
    local kept dropped
    if [[ "$side" == ours ]]; then
        kept="$SIDE_OURS ($SIDE_OURS_ROLE)"; dropped="$SIDE_THEIRS ($SIDE_THEIRS_ROLE)"
    else
        kept="$SIDE_THEIRS ($SIDE_THEIRS_ROLE)"; dropped="$SIDE_OURS ($SIDE_OURS_ROLE)"
    fi
    show_where "$(git symbolic-ref -q --short HEAD || echo '(detached)')"
    info "operation:  $(operation_in_progress)"
    info "keep:       $kept"
    info "dropped:    what $dropped wrote in these files"
    for file in "${keep[@]}"; do info "  keep    $file"; done
    for file in "${delete[@]}"; do info "  delete  $file  (that side deleted it)"; done
    confirm "Keep that side in ${#paths[@]} file(s)?"

    if (( ${#keep[@]} )); then
        run git checkout "--$side" -- "${keep[@]}" || die "git checkout failed: nothing more was done"
        run git add -- "${keep[@]}" || die "cannot mark the files as resolved"
    fi
    if (( ${#delete[@]} )); then
        run git rm -q -- "${delete[@]}" || die "cannot remove the files"
    fi
    if (( DRY_RUN )); then info "(dry run) nothing was changed"; return 0; fi

    local left kept_name=$SIDE_THEIRS
    left=$(unmerged_files | grep -c . || true)
    [[ "$side" == ours ]] && kept_name=$SIDE_OURS
    step "kept $kept_name in ${#paths[@]} file(s); $left still in conflict"
    info "to take one back:  git checkout --merge -- FILE"
    if (( left == 0 )); then info "next:  git shuttle continue"; else info "next:  resolve the others (in your editor, or here), then  git shuttle continue"; fi
}
