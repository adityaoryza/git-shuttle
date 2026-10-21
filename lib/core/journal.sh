# shellcheck shell=bash
# The journal: what each command changed in the repository, so that it can be undone and redone
#
# Sourced by bin/git-shuttle. Before and after a command that changes something, the state is recorded: where HEAD is, the local
# branches and tags, and the stash. Undo puts the repository back as it was, but only when that is safe (see cmd_undo).
# The file lives in the repository's git directory, so each repository has its own and it is never pushed.

readonly JOURNAL_KEEP=100
readonly FS=$'\x1f'      # separates the items of a snapshot; branch and tag names cannot contain it

journal_file() { printf '%s/shuttle-journal' "$(git rev-parse --git-common-dir 2>/dev/null)"; }

# journal_snapshot — one line: branch, HEAD, the stash, and every local branch and tag with its commit.
journal_snapshot() {
    git rev-parse --git-dir >/dev/null 2>&1 || return 0
    local branch head count top line
    branch=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)
    head=$(git rev-parse -q --verify HEAD 2>/dev/null || true)
    count=$(git rev-list --walk-reflogs --count refs/stash 2>/dev/null || echo 0)
    top=$(git rev-parse -q --verify refs/stash 2>/dev/null || true)
    line="branch=$branch${FS}head=$head${FS}stash=$count${FS}stashtop=$top"
    while IFS=' ' read -r sha ref; do
        [[ -n "$ref" ]] && line+="${FS}ref:$ref=$sha"
    done < <(git for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags)
    printf '%s' "$line"
}

# snapshot_get SNAPSHOT KEY — the value of one item ("ref:refs/heads/x" for a branch); empty when it is not there.
snapshot_get() {
    local item
    local -a items
    IFS="$FS" read -r -a items <<<"$1"
    for item in "${items[@]}"; do
        [[ "$item" == "$2="* ]] && { printf '%s' "${item#"$2"=}"; return 0; }
    done
    return 0
}

# snapshot_refs SNAPSHOT — the refs in it, one per line.
snapshot_refs() {
    local item
    local -a items
    IFS="$FS" read -r -a items <<<"$1"
    for item in "${items[@]}"; do
        [[ "$item" == ref:* ]] && { item=${item#ref:}; printf '%s\n' "${item%%=*}"; }
    done
}

journal_record() { # COMMAND PRE POST
    local file id
    [[ "$2" != "$3" ]] || return 0
    file=$(journal_file)
    id=$(( $(awk -F'\t' 'END { print $1 + 0 }' "$file" 2>/dev/null) + 1 ))
    {
        # a new change ends what could be redone
        [[ -f "$file" ]] && awk -F'\t' '$4 != "undone"' "$file"
        printf '%s\t%s\t%s\tdone\t%s\t%s\n' "$id" "$(date +%Y-%m-%dT%H:%M:%S)" "$1" "$2" "$3"
    } | tail -n "$JOURNAL_KEEP" > "$file.tmp" && mv "$file.tmp" "$file"
}

# journaled COMMAND ARGS... — run a command that changes things; its change is journaled when it succeeds.
journaled() {
    local command=$1 pre post rc
    shift
    if (( DRY_RUN )); then "$command" "$@"; return; fi
    pre=$(journal_snapshot)
    ( "$command" "$@" ); rc=$?
    if (( rc == 0 )); then
        post=$(journal_snapshot)
        # stash has several effects: the journal needs to know which one this was (push when none is named)
        local label=${command#cmd_}
        [[ "$label" != stash ]] || label="stash $(case "${1:-}" in apply|pop|drop) echo "$1" ;; *) echo push ;; esac)"
        journal_record "$label" "$pre" "$post"
    fi
    return "$rc"
}

# journal_entry WANTED_STATE — the newest entry in that state (done: the one to undo; undone: the one to redo).
journal_entry() {
    local file; file=$(journal_file)
    [[ -f "$file" ]] || return 0
    if [[ "$1" == "done" ]]; then awk -F'\t' '$4 == "done" { last = $0 } END { if (last != "") print last }' "$file"
    else awk -F'\t' '$4 == "undone" { last = $0 } END { if (last != "") print last }' "$file"; fi
}

journal_mark() { # ID STATE
    local file; file=$(journal_file)
    awk -F'\t' -v OFS='\t' -v id="$1" -v state="$2" '$1 == id { $4 = state } { print }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

# restore_problems FROM TO — why the repository cannot go from state FROM to state TO, one reason per line (nothing when it can).
# FROM is what the repository must look like now; TO is what it is put back to.
restore_problems() {
    local from=$1 to=$2 ref current expected target remote
    local -A seen=()
    while IFS= read -r ref; do
        [[ -n "$ref" && -z "${seen[$ref]:-}" ]] || continue
        seen[$ref]=1
        current=$(git rev-parse -q --verify "$ref" 2>/dev/null || true)
        expected=$(snapshot_get "$from" "ref:$ref")
        [[ "$current" == "$expected" ]] || echo "${ref#refs/heads/} is not where the change left it: it moved since"
        target=$(snapshot_get "$to" "ref:$ref")
        # a branch that has to move away from commits that are on a remote would rewrite what was pushed
        if [[ -n "$expected" && -n "$target" && "$expected" != "$target" && "$ref" == refs/heads/* ]]; then
            # only the commits that would drop off the branch count: moving forward again rewrites nothing
            remote=$(pushed_in_range "$target..$expected" 2>/dev/null | head -n 1)
            [[ -z "$remote" ]] || echo "${ref#refs/heads/} has commits that are on a remote: going back would rewrite pushed history"
        fi
    done < <(snapshot_refs "$from"; snapshot_refs "$to")
    [[ "$(git symbolic-ref -q --short HEAD 2>/dev/null || true)" == "$(snapshot_get "$from" branch)" ]] || echo "you are not on the branch the change left you on"
    [[ "$(git rev-parse -q --verify HEAD 2>/dev/null || true)" == "$(snapshot_get "$from" head)" ]] || echo "HEAD is not where the change left it"
    [[ "$(git rev-parse -q --verify refs/stash 2>/dev/null || true)" == "$(snapshot_get "$from" stashtop)" ]] || echo "the stash changed since"
    # new files that the old state has under the same name would be overwritten by the checkout, which git refuses half way
    local want; want=$(snapshot_get "$to" head)
    if [[ -n "$want" ]] && [[ -n "$(comm -12 <(git ls-files --others --exclude-standard | sort) <(git ls-tree -r --name-only "$want" 2>/dev/null | sort))" ]]; then
        echo "untracked files in the way: they would be overwritten (stage, stash or remove them first)"
    fi
    return 0
}

# restore_state FROM TO KEEP — put refs, HEAD and the stash back as in the snapshot TO (the tree must be clean: checked by the
# caller). KEEP=1 is for a commit: the branch moves back but its changes stay in the index, as after `git reset --soft`.
restore_state() {
    local from=$1 to=$2 keep=${3:-0} ref target now_branch want_branch want_head skip=""
    now_branch=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)
    want_branch=$(snapshot_get "$to" branch); want_head=$(snapshot_get "$to" head)
    if (( keep )) && [[ -n "$now_branch" && "$now_branch" == "$want_branch" ]]; then
        skip="refs/heads/$now_branch"
        run git reset -q --soft "$(snapshot_get "$to" "ref:$skip")" || return 1
    elif [[ -n "$now_branch" ]]; then
        # leave the branch that is checked out, so that its ref can move without the tree being touched twice
        run git checkout -q --detach || return 1
    fi
    local -A seen=()
    while IFS= read -r ref; do
        [[ -n "$ref" && "$ref" != "$skip" && -z "${seen[$ref]:-}" ]] || continue
        seen[$ref]=1
        target=$(snapshot_get "$to" "ref:$ref")
        if [[ -z "$target" ]]; then run git update-ref -d "$ref" || return 1
        elif [[ "$(git rev-parse -q --verify "$ref" 2>/dev/null || true)" != "$target" ]]; then run git update-ref "$ref" "$target" || return 1; fi
    done < <(snapshot_refs "$from"; snapshot_refs "$to")
    [[ -z "$skip" ]] || return 0
    if [[ -n "$want_branch" ]]; then run git checkout -q "$want_branch" || return 1
    elif [[ -n "$want_head" ]]; then run git checkout -q --detach "$want_head" || return 1; fi
}
