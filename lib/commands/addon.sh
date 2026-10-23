# shellcheck shell=bash
# git shuttle addon list [--porcelain] | info NAME | enable NAME [--global] | disable NAME | check NAME | cards [--porcelain]
#
# Add-ons: programs named git-shuttle-NAME, found on the PATH, that tell git-shuttle things it does not know (the task a branch is for, the
# text of a pull request...). Nothing of them is loaded into git-shuttle: it runs them, with JSON on standard input and output, and checks every
# answer (lib/addons/protocol.py) before it uses any of it. The protocol is described in docs/addons.md.
#
# An add-on does nothing until it is enabled, and enabling pins the program: if the file changes (an update), it must be enabled again, which
# shows what it asks for once more. It gets no terminal, no input but the JSON, a short list of environment variables, a time limit and a
# size limit. git-shuttle never downloads or installs one.

ADDON_PROTOCOL=1
ADDON_TIMEOUT=${GIT_SHUTTLE_ADDON_TIMEOUT:-20}
ADDON_MAX_OUTPUT=262144
# what an add-on cannot be called: the commands of git-shuttle itself
ADDON_RESERVED=" status commit sync push merge pick ship release init continue abort candidates start switch branch cherry-pick undo redo journal fetch rename delete upstream merge-in rebase-on compare revert amend tag untag reset link rewrite drop move stash worktree patch pull stage unstage discard ui update pr deploy hook config check-message addon help version "

addon_need_python() {
    [[ -n "${ADDON_PY:-}" ]] && return 0
    ADDON_PY=python3
    "$ADDON_PY" -c '' >/dev/null 2>&1 || ADDON_PY=python
    "$ADDON_PY" -c '' >/dev/null 2>&1 || die "add-ons need python3 (the web UI needs it too)"
}
addon_proto() { "$ADDON_PY" -I "$ROOT/lib/addons/protocol.py" "$@"; }

addon_valid_name() { [[ "$1" =~ ^[a-z][a-z0-9-]{0,30}$ && "$ADDON_RESERVED" != *" $1 "* ]]; }

# addon_dirs — where add-ons are looked for: GIT_SHUTTLE_ADDON_PATH (for tests and unusual installs), then the PATH.
addon_dirs() {
    local dir
    local IFS=:
    # only absolute folders: an empty or relative entry of the PATH means "here", and a repository must not be able to offer a program that way
    for dir in ${GIT_SHUTTLE_ADDON_PATH:-} "$(addon_home)/bin" $PATH; do [[ "$dir" == /* && -d "$dir" ]] && printf '%s\n' "$dir"; done
}

# addon_find NAME — the real path of git-shuttle-NAME (links followed), or nothing.
addon_find() {
    local dir file
    addon_valid_name "$1" || return 1
    while IFS= read -r dir; do
        file="$dir/git-shuttle-$1"
        if [[ -f "$file" && -x "$file" ]]; then readlink -f "$file" 2>/dev/null || printf '%s' "$file"; return 0; fi
    done < <(addon_dirs)
    return 1
}

# addon_names — the names of the add-ons found, one per line.
addon_names() {
    local dir file name
    while IFS= read -r dir; do
        for file in "$dir"/git-shuttle-*; do
            [[ -f "$file" && -x "$file" ]] || continue
            name=${file##*/git-shuttle-}
            addon_valid_name "$name" && printf '%s\n' "$name"
        done
    done < <(addon_dirs) | sort -u
}

addon_sha() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

addon_cfg() { git config --get "shuttle.addon.$1.$2" 2>/dev/null || true; }
addon_cfg_all() { git config --get-all "shuttle.addon.$1.$2" 2>/dev/null || true; }

# addon_state NAME — enabled, changed (enabled, but the file is not the one that was enabled), or found.
addon_state() {
    local exe; exe=$(addon_find "$1") || { printf 'missing'; return 0; }
    if [[ "$(addon_cfg "$1" enabled)" != true ]]; then printf 'found'
    elif [[ "$(addon_cfg "$1" sha256)" == "$(addon_sha "$exe")" ]]; then printf 'enabled'
    else printf 'changed'; fi
}

# addon_usable NAME HOOK — an add-on that is enabled, unchanged, and declares the hook.
addon_usable() {
    [[ "$(addon_state "$1")" == enabled ]] && addon_cfg_all "$1" hooks | grep -qx "$2"
}

# addon_flag_owner COMMAND FLAG — the enabled add-on that declared the flag for the command (empty when none).
addon_flag_owner() {
    local name
    while IFS= read -r name; do
        if [[ "$(addon_state "$name")" == enabled ]] && addon_cfg_all "$name" flags | grep -qx "$1:$2"; then printf '%s' "$name"; return 0; fi
    done < <(addon_names)
    return 0
}

# --- running one ------------------------------------------------------------------------------------------------------------------------

# addon_run NAME INPUT_FILE ARGS... — runs git-shuttle-NAME on its own: the JSON file as input, a short environment, a time limit, no terminal.
# Sets ADDON_OUT and ADDON_ERR (temporary files) and ADDON_RC; returns 1, with ADDON_PROBLEM, when it could not be run or said too much.
addon_run() {
    local name=$1 input=$2 exe var
    shift 2
    ADDON_PROBLEM=""
    exe=$(addon_find "$name") || { ADDON_PROBLEM="git-shuttle-$name is not on the PATH"; return 1; }
    local envargs=("PATH=$PATH" "HOME=$HOME" "LANG=${LANG:-C.UTF-8}" "TERM=dumb" "NO_COLOR=1" "GIT_TERMINAL_PROMPT=0" "GIT_SHUTTLE_PROTOCOL=$ADDON_PROTOCOL")
    [[ -z "${XDG_CONFIG_HOME:-}" ]] || envargs+=("XDG_CONFIG_HOME=$XDG_CONFIG_HOME")
    [[ -z "${TMPDIR:-}" ]] || envargs+=("TMPDIR=$TMPDIR")
    # only the variables that it said it needs, and that you saw when you enabled it
    while IFS= read -r var; do
        [[ "$var" =~ ^[A-Z][A-Z0-9_]*$ && -n "${!var+x}" ]] && envargs+=("$var=${!var}")
    done < <(if [[ -n "${ADDON_ENV_OVERRIDE+x}" ]]; then printf '%s\n' "$ADDON_ENV_OVERRIDE"; else addon_cfg_all "$name" env; fi)
    local guard=() detach=()
    command -v timeout >/dev/null 2>&1 && guard=(timeout "${ADDON_RUN_TIMEOUT:-$ADDON_TIMEOUT}")
    command -v setsid >/dev/null 2>&1 && detach=(setsid -w)
    ADDON_OUT=$(mktemp); ADDON_ERR=$(mktemp)
    # at most one byte more than the limit is kept: a program that never stops writing fills nothing
    { "${detach[@]}" "${guard[@]}" env -i "${envargs[@]}" "$exe" "$@" <"$input" 2>"$ADDON_ERR"; } | head -c $((ADDON_MAX_OUTPUT + 1)) >"$ADDON_OUT"
    ADDON_RC=${PIPESTATUS[0]}
    if (( ADDON_RC == 124 )); then ADDON_PROBLEM="it did not answer in ${ADDON_RUN_TIMEOUT:-$ADDON_TIMEOUT} s"; return 1; fi
    # too much comes first: a program that is cut off by the limit is ended by the broken pipe (exit 141), and that is not its fault to report
    if (( $(wc -c <"$ADDON_OUT") > ADDON_MAX_OUTPUT )); then ADDON_PROBLEM="its answer is longer than $((ADDON_MAX_OUTPUT / 1024)) KiB"; return 1; fi
    if (( ADDON_RC != 0 )); then ADDON_PROBLEM="it failed (exit $ADDON_RC): $(head -c 300 "$ADDON_ERR" | tr '\n' ' ')"; return 1; fi
    return 0
}

addon_cleanup() { rm -f "${ADDON_OUT:-}" "${ADDON_ERR:-}" "${ADDON_NORM:-}"; ADDON_OUT=""; ADDON_ERR=""; ADDON_NORM=""; }

# addon_validate KIND [NAME] — checks ADDON_OUT with the protocol; the normal form goes to ADDON_NORM. Returns 1, with ADDON_PROBLEM, when it is refused.
addon_validate() {
    ADDON_NORM=$(mktemp)
    if ! addon_proto validate "$@" <"$ADDON_OUT" >"$ADDON_NORM" 2>"$ADDON_ERR"; then
        ADDON_PROBLEM="its answer was refused: $(head -c 300 "$ADDON_ERR" | tr '\n' ' ')"
        return 1
    fi
    return 0
}

# addon_hook NAME HOOK key=value... — calls a hook of an enabled add-on and checks the answer (left in ADDON_NORM). Returns 1, with ADDON_PROBLEM.
addon_hook() {
    local name=$1 hook=$2 input
    shift 2
    addon_need_python
    addon_cleanup
    ADDON_PROBLEM=""
    addon_usable "$name" "$hook" || { ADDON_PROBLEM="git-shuttle-$name is not enabled for '$hook' (git shuttle addon list)"; return 1; }
    input=$(mktemp)
    addon_proto input "$hook" "$@" >"$input"
    if addon_run "$name" "$input" hook "$hook" && addon_validate "$hook"; then rm -f "$input"; return 0; fi
    rm -f "$input"
    return 1
}

# addon_rec KEY — the value of the first record with that key in ADDON_NORM.
addon_rec() {
    local rec
    while IFS= read -r -d '' rec; do
        if [[ "$rec" == "$1="* ]]; then printf '%s' "${rec#*=}"; return 0; fi
    done <"$ADDON_NORM"
    return 0
}
# addon_rec_all KEY — every value of that key, one per line.
addon_rec_all() {
    local rec
    while IFS= read -r -d '' rec; do
        [[ "$rec" == "$1="* ]] && printf '%s\n' "${rec#*=}"
    done <"$ADDON_NORM"
    return 0
}

# addon_manifest NAME — runs `git-shuttle-NAME --shuttle-manifest` and checks it (the normal form is in ADDON_NORM).
addon_manifest() {
    local input
    addon_need_python
    addon_cleanup
    input=$(mktemp); : >"$input"
    if addon_run "$1" "$input" --shuttle-manifest && addon_validate manifest "$1"; then rm -f "$input"; return 0; fi
    rm -f "$input"
    return 1
}

# addon_passthrough COMMAND ARGS... — `git shuttle NAME ARGS` runs git-shuttle-NAME when it is enabled. Returns 1 when NAME is no add-on at all.
addon_passthrough() {
    local name=$1 exe state
    shift
    exe=$(addon_find "$name") || return 1
    state=$(addon_state "$name")
    case "$state" in
        enabled) exec "$exe" "$@" ;;
        changed) die "git-shuttle-$name is not the program that was enabled (it changed): look at it, then  git shuttle addon enable $name" ;;
        *)       die "git-shuttle-$name is on your PATH but it is not enabled:  git shuttle addon enable $name" ;;
    esac
}

# --- the commands --------------------------------------------------------------------------------------------------------------------------

addon_list() {
    local porcelain=${1:-0} name state exe version any=0
    if (( porcelain )); then
        while IFS= read -r name; do
            [[ -n "$name" ]] || continue
            printf 'addon=%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\0' "$name" "$(addon_state "$name")" "$(addon_find "$name")" "$(addon_cfg "$name" version)" \
                "$([[ "$(addon_state "$name")" == enabled ]] && addon_cfg_all "$name" flags | paste -sd' ' -)" \
                "$([[ "$(addon_state "$name")" == enabled ]] && addon_cfg_all "$name" hooks | paste -sd' ' -)"
        done < <(addon_names)
        return 0
    fi
    printf '%-18s %-9s %-9s %s\n' add-on state version path
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        any=1; state=$(addon_state "$name"); exe=$(addon_find "$name"); version=$(addon_cfg "$name" version)
        printf '%-18s %-9s %-9s %s\n' "$name" "$state" "${version:--}" "$exe"
    done < <(addon_names)
    if (( ! any )); then
        info "No add-on found. An add-on is a program named git-shuttle-NAME on your PATH (docs/addons.md says how it talks to git-shuttle)."
    else
        info ""
        info "found: not enabled yet (git shuttle addon enable NAME); changed: enabled, but the program is not the one that was enabled."
    fi
}

# addon_show_manifest NAME — what the add-on asks for, in words (from ADDON_NORM).
addon_show_manifest() {
    local n=$1 line
    info "add-on:      $n $(addon_rec version)"
    info "what it is:  $(addon_rec description)"
    info "program:     $(addon_find "$n")"
    info "hooks:       $(addon_rec_all hook | paste -sd' ' -)"
    line=$(addon_rec_all flag | paste -sd' ' -)
    [[ -z "$line" ]] || info "adds flags:  $line"
    line=$(addon_rec_all env | paste -sd' ' -)
    [[ -z "$line" ]] || info "may read:    $line  (the only environment variables it receives)"
}

addon_info() {
    local name=$1
    addon_valid_name "$name" || die "'$name' is not an add-on name (lowercase letters, digits and -; not a command of git-shuttle)"
    addon_find "$name" >/dev/null || die "no program git-shuttle-$name on your PATH"
    info "(this runs  git-shuttle-$name --shuttle-manifest  to read what it asks for)"
    addon_manifest "$name" || die "git-shuttle-$name: $ADDON_PROBLEM"
    addon_show_manifest "$name"
    info "state:       $(addon_state "$name")"
    addon_cleanup
}

addon_enable() {
    local name=$1 scope=${2:-} exe sha hook flag var
    addon_valid_name "$name" || die "'$name' is not an add-on name (lowercase letters, digits and -; not a command of git-shuttle)"
    exe=$(addon_find "$name") || die "no program git-shuttle-$name on your PATH"
    if [[ -z "$scope" ]]; then
        if git rev-parse --show-toplevel >/dev/null 2>&1; then scope=--local
        else die "not inside a repository: enable it for every repository with  --global"; fi
    fi
    info "(this runs  git-shuttle-$name --shuttle-manifest  to read what it asks for)"
    addon_manifest "$name" || die "git-shuttle-$name cannot be enabled: $ADDON_PROBLEM"
    addon_show_manifest "$name"
    sha=$(addon_sha "$exe")
    info "pinned to:   sha256 ${sha:0:16}…  (if the program changes, it has to be enabled again)"
    info "scope:       ${scope#--}"
    confirm "Enable the add-on '$name'?"
    run git config "$scope" --unset-all "shuttle.addon.$name.hooks" 2>/dev/null || true
    run git config "$scope" --unset-all "shuttle.addon.$name.flags" 2>/dev/null || true
    run git config "$scope" --unset-all "shuttle.addon.$name.env" 2>/dev/null || true
    while IFS= read -r hook; do [[ -n "$hook" ]] && run git config "$scope" --add "shuttle.addon.$name.hooks" "$hook"; done < <(addon_rec_all hook)
    while IFS= read -r flag; do [[ -n "$flag" ]] && run git config "$scope" --add "shuttle.addon.$name.flags" "$flag"; done < <(addon_rec_all flag)
    while IFS= read -r var; do [[ -n "$var" ]] && run git config "$scope" --add "shuttle.addon.$name.env" "$var"; done < <(addon_rec_all env)
    run git config "$scope" "shuttle.addon.$name.version" "$(addon_rec version)"
    run git config "$scope" "shuttle.addon.$name.sha256" "$sha"
    run git config "$scope" "shuttle.addon.$name.enabled" true
    addon_cleanup
    step "add-on '$name' enabled"
}

addon_disable() {
    local name=$1 scope any=0
    addon_valid_name "$name" || die "'$name' is not an add-on name"
    for scope in --local --global; do
        if git config "$scope" --get-regexp "^shuttle\\.addon\\.$name\\." >/dev/null 2>&1; then
            any=1
            run git config "$scope" --remove-section "shuttle.addon.$name" || die "cannot remove the settings of '$name'"
        fi
    done
    (( any )) || die "the add-on '$name' is not enabled"
    step "add-on '$name' disabled (the program itself is not touched)"
}

# addon_check NAME — for the author of an add-on: does it answer the way the protocol says? (It does not need to be enabled.)
addon_check() {
    local name=$1 bad=0 hook input flags flag hooks
    local -a args
    local scheme=https       # (the made-up address of the check is put together: the tests of the repository allow no address that is not listed)
    addon_valid_name "$name" || die "'$name' is not an add-on name"
    addon_find "$name" >/dev/null || die "no program git-shuttle-$name on your PATH"
    addon_need_python
    if addon_manifest "$name"; then info "ok    the manifest is valid (protocol $ADDON_PROTOCOL)"
    else info "FAIL  the manifest: $ADDON_PROBLEM"; addon_cleanup; return 1; fi
    hooks=$(addon_rec_all hook); flags=$(addon_rec_all flag)
    ADDON_ENV_OVERRIDE=$(addon_rec_all env)     # the variables it declared: the check runs it with the same environment as in use
    for hook in $hooks; do
        args=("repo.root=/check" "repo.name=check" "branch=feature/check" "base=staging" "ref-id=1" "ref-title=A task" "ref-link=$scheme://example.test/1" "commits=a commit")
        while IFS= read -r flag; do
            [[ "$flag" == "$hook:"* ]] && args+=("arg.${flag#"$hook":--}=1")
        done <<<"$flags"
        input=$(mktemp)
        addon_proto input "$hook" "${args[@]}" >"$input"
        addon_cleanup
        if addon_run "$name" "$input" hook "$hook" && addon_validate "$hook"; then
            info "ok    hook '$hook' answered, and the answer is valid"
        elif (( ${ADDON_RC:-0} == 1 )) && [[ -s "$ADDON_ERR" ]] && ! grep -q "Traceback" "$ADDON_ERR"; then
            # "I cannot" is an answer: exit 1 and a message (an unknown task, no connection). A crash, or any other status, is a defect.
            info "ok    hook '$hook' declined, saying why: $(head -c 140 "$ADDON_ERR" | tr '\n' ' ')"
        else
            info "FAIL  hook '$hook': $ADDON_PROBLEM"; bad=1
        fi
        rm -f "$input"
    done
    unset ADDON_ENV_OVERRIDE
    addon_cleanup
    (( bad == 0 )) || return 1
    step "git-shuttle-$name follows protocol $ADDON_PROTOCOL"
}

# addon_tasks [PORCELAIN] — the tasks to choose from, as the enabled add-ons that have a `tasks` hook say them (it may ask a server: more time).
addon_tasks() {
    local porcelain=${1:-0} all=${2:-0} name json any=0 input
    need_repo
    ADDON_RUN_TIMEOUT=${GIT_SHUTTLE_ADDON_TASKS_TIMEOUT:-45}
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        addon_usable "$name" tasks || continue
        addon_need_python
        addon_cleanup
        input=$(mktemp)
        addon_proto input tasks "repo.root=$REPO_ROOT" "repo.name=$REPO_NAME" $( ((all)) && echo "arg.all=1") >"$input"
        if addon_run "$name" "$input" hook tasks && addon_validate tasks; then
            any=1
            json=$(cat "$ADDON_NORM")
            if (( porcelain )); then printf '%s\0' "addon=$name"$'\x1f'"$json"
            else
                info "[$name]"
                printf '%s' "$json" | "$ADDON_PY" -I -c 'import json,sys
d = json.load(sys.stdin)
if d["note"]: print("(" + d["note"] + ")")
for t in d["tasks"]: print("%-8s %-16s %s" % (t["id"], t["subtitle"][:16], t["title"]))
if not d["tasks"]: print("(no task)")'
            fi
        else
            if (( porcelain )); then printf '%s\0' "problem=$name"$'\x1f'"$ADDON_PROBLEM"; else warn "add-on '$name': $ADDON_PROBLEM"; fi
        fi
        rm -f "$input"
        addon_cleanup
    done < <(addon_names)
    unset ADDON_RUN_TIMEOUT
    (( any || porcelain )) || info "No enabled add-on can list tasks (git shuttle addon list)."
    return 0
}

# addon_setup NAME [SAVE] [PORCELAIN] — what an add-on needs from you (a login, a key). Without SAVE it shows the fields and whether it is ready; with SAVE
# it reads {"key": "value"} from standard input (a key never goes on a command line, where others can read it) and gives it to the add-on to keep.
# What the add-on says back is checked, and a value that you gave is hidden if the add-on repeats it.
addon_setup() {
    local name=$1 save=${2:-0} porcelain=${3:-0} input values="" rc=0 json
    need_repo
    addon_need_python
    addon_usable "$name" setup || die "git-shuttle-$name is not enabled for 'setup' (git shuttle addon list)"
    addon_cleanup
    input=$(mktemp)
    if (( save )); then
        values=$(mktemp)
        cat >"$values"
        if ! addon_proto input-setup save - <"$values" >"$input" 2>"$values.err"; then
            local why; why=$(head -c 300 "$values.err"); rm -f "$input" "$values" "$values.err"; die "the values are refused: $why"
        fi
        rm -f "$values.err"
    else
        addon_proto input-setup status none </dev/null >"$input"
    fi
    ADDON_RUN_TIMEOUT=${GIT_SHUTTLE_ADDON_TASKS_TIMEOUT:-45}
    if addon_run "$name" "$input" hook setup && addon_validate "$( ((save)) && echo setup-save || echo setup)"; then
        json=$(cat "$ADDON_NORM")
        if (( save )); then
            json=$(printf '%s' "$json" | "$ADDON_PY" -I -c 'import json, sys
doc = json.load(sys.stdin)
for value in json.load(open(sys.argv[1])).values():
    if len(value) >= 4:
        doc["message"] = doc["message"].replace(value, "***")
print(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))' "$values")
        fi
        if (( porcelain )); then printf '%s\0' "$json"
        elif (( save )); then
            printf '%s' "$json" | "$ADDON_PY" -I -c 'import json, sys
d = json.load(sys.stdin)
print(("saved: " if d["ok"] else "not saved: ") + d["message"])
sys.exit(0 if d["ok"] else 1)' || rc=1
        else
            printf '%s' "$json" | "$ADDON_PY" -I -c 'import json, sys
d = json.load(sys.stdin)
print("ready" if d["ready"] else "not ready yet")
if d["note"]: print("(" + d["note"] + ")")
for f in d["fields"]:
    shown = ("(set)" if f["set"] else "(not set)") if f["kind"] == "secret" else (f["value"] or "(empty)")
    print("%-16s %s%s" % (f["key"], shown, "  *" if f["required"] else ""))'
        fi
    else
        if (( porcelain )); then printf '%s\0' "$(printf '{"ok":false,"fields":[],"ready":false,"message":%s}' "$(printf '%s' "$ADDON_PROBLEM" | "$ADDON_PY" -I -c 'import json,sys; print(json.dumps(sys.stdin.read()[:300]))')")"
        else warn "add-on '$name': $ADDON_PROBLEM"; rc=1; fi
    fi
    unset ADDON_RUN_TIMEOUT
    rm -f "$input" "$values"
    addon_cleanup
    return "$rc"
}

# addon_cards [PORCELAIN] — what the enabled add-ons that have a status hook show for the branch you are on.
addon_cards() {
    local porcelain=${1:-0} branch name json any=0 root ref_addon ref_id ref_title ref_link title
    need_repo
    branch=$(git symbolic-ref -q --short HEAD 2>/dev/null || true)
    root=$REPO_ROOT
    ref_addon=$(git config --get "branch.$branch.shuttle-ref-addon" 2>/dev/null || true)
    ref_id=$(git config --get "branch.$branch.shuttle-ref-id" 2>/dev/null || true)
    ref_title=$(git config --get "branch.$branch.shuttle-ref-title" 2>/dev/null || true)
    ref_link=$(git config --get "branch.$branch.shuttle-ref-link" 2>/dev/null || true)
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        addon_usable "$name" status || continue
        addon_need_python
        addon_cleanup
        local input; input=$(mktemp)
        addon_proto input status "repo.root=$root" "repo.name=$REPO_NAME" "branch=$branch" "ref-addon=$ref_addon" "ref-id=$ref_id" "ref-title=$ref_title" "ref-link=$ref_link" >"$input"
        if addon_run "$name" "$input" hook status && addon_validate status; then
            any=1
            json=$(cat "$ADDON_NORM")
            if (( porcelain )); then printf '%s\0' "addon=$name"$'\x1f'"$json"
            else
                title=$(printf '%s' "$json" | "$ADDON_PY" -I -c 'import json,sys
for c in json.load(sys.stdin)["cards"]:
    print("== " + c["title"] + ("  (" + c["subtitle"] + ")" if c["subtitle"] else ""))
    if c["link"]: print(c["link"])
    for f in c["fields"]: print("%s: %s" % (f["label"], f["value"]))
    if c["text"]: print(); print(c["text"])')
                info "[$name]"; info "$title"
            fi
        else
            # the reason is given in the machine form too: the page says why an add-on shows nothing
            if (( porcelain )); then printf '%s\0' "problem=$name"$'\x1f'"$ADDON_PROBLEM"; else warn "add-on '$name': $ADDON_PROBLEM"; fi
        fi
        rm -f "$input"
        addon_cleanup
    done < <(addon_names)
    (( any || porcelain )) || info "No add-on has anything to show for '${branch:-this HEAD}' (git shuttle addon list)."
    return 0
}

cmd_addon() {
    local sub=${1:-list} scope="" porcelain=0 name="" version="" save=0 all=0
    shift || true
    while (( $# )); do
        case "$1" in
            --global) scope=--global; shift ;;
            --porcelain) porcelain=1; shift ;;
            --save) save=1; shift ;;
            --all) all=1; shift ;;
            --version) [[ $# -ge 2 ]] || die "--version needs a tag, for example v0.2.0"; version=$2; shift 2 ;;
            -*) die "addon: unknown option '$1'" ;;
            *) [[ -z "$name" ]] || die "addon: one name at a time ('$name' and '$1')"; name=$1; shift ;;
        esac
    done
    case "$sub" in
        list)    [[ -z "$name" ]] || die "addon list takes no name"; addon_list "$porcelain" ;;
        info)    [[ -n "$name" ]] || die "addon info needs a name"; addon_info "$name" ;;
        enable)  [[ -n "$name" ]] || die "addon enable needs a name"; addon_enable "$name" "$scope" ;;
        disable) [[ -n "$name" ]] || die "addon disable needs a name"; addon_disable "$name" ;;
        check)   [[ -n "$name" ]] || die "addon check needs a name"; addon_check "$name" ;;
        cards)   [[ -z "$name" ]] || die "addon cards takes no name"; addon_cards "$porcelain" ;;
        tasks)   [[ -z "$name" ]] || die "addon tasks takes no name"; addon_tasks "$porcelain" "$all" ;;
        setup)   [[ -n "$name" ]] || die "addon setup needs a name"; addon_setup "$name" "$save" "$porcelain" ;;
        available) [[ -z "$name" ]] || die "addon available takes no name"; addon_available "$porcelain" ;;
        install)   [[ -n "$name" ]] || die "addon install needs a name (git shuttle addon available)"; addon_install "$name" "$version" ;;
        uninstall) [[ -n "$name" ]] || die "addon uninstall needs a name"; addon_uninstall "$name" ;;
        *)       die "addon: '$sub' is not a command (list, info, enable, disable, check, cards, tasks, setup, available, install, uninstall)" ;;
    esac
}
