# shellcheck shell=bash
# git shuttle conflicts [--porcelain] [FILE...] — the places where a file is in conflict, one by one
#
# For each place (a "hunk"): the lines before it, what your side has, what the other side has, and, when the file was written with the
# diff3 style, what both started from. And who last changed the lines of your side on this branch: with a release made of several
# commits that is the answer to "which of my commits is this about?". `git shuttle resolve --hunk N=ours|theirs|both ... -- FILE` chooses.
# FILE is as `git shuttle status` lists the conflicts (from the top of the repository).

CONFLICT_MAX_BYTES=2000000

# The parser of the markers (<<<<<<<, |||||||, =======, >>>>>>>), used by the listing and by the resolution so that they number the
# hunks the same way. First input: the file as our side has it (stage 2), to find where the lines of "ours" are on this branch; second input:
# the file with the markers.
#   -v mode=count                       prints the number of hunks
#   -v mode=list                        prints the facts about each hunk, each ended by a GS (\035), their parts separated by US (\037)
#   -v mode=apply -v choices=1=ours,2=theirs   prints the file with those hunks resolved (the others keep their markers); a choice is ours, theirs,
#                                       both, both-reverse, base, or pick:o1+t2+o3 (the lines of ours (o), theirs (t) or base (b), one by one, in that order)
# shellcheck disable=SC2016  # an awk program
CONFLICT_AWK='
function unmark(s) { sub(/\r$/, "", s); return s }
function lines_of(kind, h,    k, s) { s = ""; for (k = 1; k <= CNT[kind, h]; k++) s = s (k > 1 ? "\n" : "") unmark(TXT[kind, h, k]); return s }
function put(kind, h,    k) { for (k = 1; k <= CNT[kind, h]; k++) print TXT[kind, h, k] }
FNR == NR { S[FNR] = $0; SN = FNR; next }
{ L[++N] = $0 }
END {
    nh = 0; i = 1; last_found = 0
    while (i <= N) {
        t = unmark(L[i])
        if (t ~ /^<<<<<<< / || t == "<<<<<<<") {
            j = i + 1; side = "o"; has_base = 0; co = 0; cb = 0; ct = 0
            while (j <= N) {
                u = unmark(L[j])
                if (u ~ /^\|\|\|\|\|\|\| / || u == "|||||||") { side = "b"; has_base = 1 }
                else if (u == "=======") { side = "t" }
                else if (u ~ /^>>>>>>> / || u == ">>>>>>>") { break }
                else if (u ~ /^<<<<<<< /) { j = N + 1; break }
                else if (side == "o") { co++; TXT["o", nh + 1, co] = L[j] }
                else if (side == "b") { cb++; TXT["b", nh + 1, cb] = L[j] }
                else { ct++; TXT["t", nh + 1, ct] = L[j] }
                j++
            }
            if (j > N) { i++; continue }
            nh++
            HS[nh] = i; HE[nh] = j; CNT["o", nh] = co; CNT["b", nh] = cb; CNT["t", nh] = ct; HB[nh] = has_base
            i = j + 1
        } else { i++ }
    }
    if (mode == "count") { print nh; exit }
    if (mode == "list") {
        for (h = 1; h <= nh; h++) {
            # where the lines of "ours" are in the file as our side has it (the first place after the previous hunk)
            rs = ""; re = ""
            if (CNT["o", h] > 0) {
                for (k = last_found + 1; k + CNT["o", h] - 1 <= SN; k++) {
                    ok = 1
                    for (m = 1; m <= CNT["o", h]; m++) if (S[k + m - 1] != TXT["o", h, m]) { ok = 0; break }
                    if (ok) { rs = k; re = k + CNT["o", h] - 1; last_found = re; break }
                }
            }
            printf "hunk=%d\037%d\037%d\037%s\037%s\037%d\037%d\037%d\035", h, HS[h], HE[h], rs, re, CNT["o", h], CNT["b", h], CNT["t", h]
            from = HS[h] - 3; if (h > 1 && from <= HE[h - 1]) from = HE[h - 1] + 1; if (from < 1) from = 1
            s = ""; for (k = from; k < HS[h]; k++) s = s (k > from ? "\n" : "") unmark(L[k])
            printf "before=%d\037%s\035", h, s
            printf "ours=%d\037%s\035", h, lines_of("o", h)
            if (HB[h]) printf "base=%d\037%s\035", h, lines_of("b", h)
            printf "theirs=%d\037%s\035", h, lines_of("t", h)
            to = HE[h] + 3; if (h < nh && to >= HS[h + 1]) to = HS[h + 1] - 1; if (to > N) to = N
            s = ""; for (k = HE[h] + 1; k <= to; k++) s = s (k > HE[h] + 1 ? "\n" : "") unmark(L[k])
            printf "after=%d\037%s\035", h, s
        }
        exit
    }
    # apply
    n = split(choices, parts, ",")
    for (k = 1; k <= n; k++) { split(parts[k], kv, "="); CH[kv[1] + 0] = kv[2] }
    h = 1; i = 1
    while (i <= N) {
        if (h <= nh && i == HS[h]) {
            c = CH[h]
            if (c == "ours") put("o", h)
            else if (c == "theirs") put("t", h)
            else if (c == "both") { put("o", h); put("t", h) }
            else if (c == "both-reverse") { put("t", h); put("o", h) }
            else if (c == "base") { if (!HB[h]) { print "hunk " h " has no base: the file was not written in the diff3 style" > "/dev/stderr"; exit 3 } put("b", h) }
            else if (c ~ /^pick:/) {
                spec = substr(c, 6); np = (spec == "") ? 0 : split(spec, tok, "+")
                for (k = 1; k <= np; k++) {
                    kind = substr(tok[k], 1, 1); idx = substr(tok[k], 2) + 0
                    if (kind == "b" && !HB[h]) { print "place " h " has no base: the file was not written in the diff3 style" > "/dev/stderr"; exit 3 }
                    if (idx < 1 || idx > CNT[kind, h]) { print "place " h " has no line " tok[k] > "/dev/stderr"; exit 3 }
                    print TXT[kind, h, idx]
                }
            }
            else { for (k = HS[h]; k <= HE[h]; k++) print L[k] }
            i = HE[h] + 1; h++
        } else { print L[i]; i++ }
    }
}'

# conflict_blame N FILE FROM TO — who last changed lines FROM..TO of the file on this branch (HEAD): one record for each commit, with the
# number of lines, and, when it is one of the commits this pick made, which commit of the pick it was.
conflict_blame() {
    local n=$1 file=$2 from=$3 to=$4 line sha="" order=() plan="" picked rel
    local -A count=() subject=() author=()
    plan=$(pick_plan_file)
    while IFS= read -r line; do
        if [[ "$line" =~ ^([0-9a-f]{40})\ [0-9]+\ [0-9]+ ]]; then
            sha=${BASH_REMATCH[1]}
            [[ -n "${count[$sha]:-}" ]] || order+=("$sha")
            count[$sha]=$(( ${count[$sha]:-0} + 1 ))
        elif [[ "$line" == summary\ * ]]; then subject[$sha]=${line#summary }
        elif [[ "$line" == author\ * ]]; then author[$sha]=${line#author }
        fi
    done < <(git blame --porcelain -L "$from,$to" HEAD -- "$file" 2>/dev/null)
    for sha in "${order[@]}"; do
        picked=""
        [[ -f "$plan" ]] && picked=$(sed -n "s/^result=\([0-9]*\):$sha\$/\1/p" "$plan" | head -n 1)
        rel=$(git show -s --format=%cr "$sha" 2>/dev/null || true)
        printf 'blame=%s\037%s\037%s\037%s\037%s\037%s\037%s\035' "$n" "$sha" "${subject[$sha]:-}" "${author[$sha]:-}" "$rel" "$picked" "${count[$sha]}"
    done
}

# conflict_listing FILE — the facts about the hunks of one file, as the porcelain records (NUL separated), blame included.
conflict_listing() {
    local file=$1 ours_tmp out rec n rs re blame=""
    ours_tmp=$(mktemp)
    git show ":2:$file" > "$ours_tmp" 2>/dev/null || : > "$ours_tmp"
    out=$(awk -v mode=list "$CONFLICT_AWK" "$ours_tmp" "$file"; printf x)
    out=${out%x}
    rm -f "$ours_tmp"
    printf 'file=%s\035' "$file"
    printf '%s' "$out"
    while IFS= read -r -d $'\035' rec; do
        [[ "$rec" == hunk=* ]] || continue
        IFS=$'\037' read -r n _ _ rs re _ _ _ <<<"${rec#hunk=}"
        [[ -n "$rs" ]] && blame+=$(conflict_blame "$n" "$file" "$rs" "$re")
    done <<<"$out"
    printf '%s' "$blame"
}

cmd_conflicts() {
    local porcelain=0 files=()
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            --) shift; files+=("$@"); break ;;
            -*) die "conflicts: unknown option '$1'" ;;
            *)  files+=("$1"); shift ;;
        esac
    done
    need_repo
    [[ -n "$(operation_in_progress)" ]] || die "nothing is waiting: there is no conflict"
    cd "$REPO_ROOT" || die "cannot enter $REPO_ROOT"
    local GIT_LITERAL_PATHSPECS=1; export GIT_LITERAL_PATHSPECS

    local unmerged file
    unmerged=$(unmerged_files)
    if (( ! ${#files[@]} )); then
        while IFS= read -r file; do [[ -n "$file" ]] && files+=("$file"); done <<<"$unmerged"
    fi
    for file in "${files[@]}"; do
        if [[ -z "$file" ]] || ! grep -Fxq -- "$file" <<<"$unmerged"; then die "'$file' is not in conflict (git shuttle status lists the files that are)"; fi
        [[ -f "$file" ]] || die "'$file' is not in the working tree: it has no places to look at (it was deleted on one side: keep a side with  git shuttle resolve)"
        (( $(wc -c < "$file") <= CONFLICT_MAX_BYTES )) || die "'$file' is too big to be shown place by place: keep a whole side with  git shuttle resolve"
    done

    if (( porcelain )); then
        (( ${#files[@]} == 1 )) || die "conflicts --porcelain takes one file"
        conflict_listing "${files[0]}" | tr '\035' '\0'
        return 0
    fi

    local ours_tmp total
    for file in "${files[@]}"; do
        ours_tmp=$(mktemp)
        git show ":2:$file" > "$ours_tmp" 2>/dev/null || : > "$ours_tmp"
        total=$(awk -v mode=count "$CONFLICT_AWK" "$ours_tmp" "$file")
        rm -f "$ours_tmp"
        info "$file: $total place(s) in conflict"
        conflict_listing "$file" | tr '\035\037' '\n\t' | awk -F'\t' '/^hunk=/ { sub(/^hunk=/, "", $1); printf "  place %s: lines %s to %s\n", $1, $2, $3 }'
    done
}
