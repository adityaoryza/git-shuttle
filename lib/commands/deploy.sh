# shellcheck shell=bash
# git shuttle deploy [TARGET] [--modules A,B] [--confirm TARGET] [--plan [--porcelain]] [--check]
# git shuttle deploy --setup [NAME] [--host H] [--port N] [--command C] [--branch B] [--sudo none|ask] [--detector none|odoo] [--require-name|--no-require-name]
# git shuttle deploy --list | --forget NAME
#
# Runs the update command of a server over ssh, after a push: one saved target per server (staging, production...), with the same
# checks and the same preview every time. Targets live in `git config shuttle.deploy.<name>.*` of the repository: no password or key
# is ever stored; ssh uses your ssh config and agent, and on a terminal it asks for the login password itself (one shared connection, like
# odoo-mirror); without a terminal it never asks (BatchMode). The sudo password, when the
# server asks for it (sudo=ask), is typed into the prompt of sudo itself on your terminal: git-shuttle never reads it.

DEPLOY_KEYS=(host port command branch sudo detector confirm)

deploy_cfg() { git config --get "shuttle.deploy.$1.$2" 2>/dev/null || true; }

# deploy_targets — the names of the saved targets, one per line.
deploy_targets() {
    git config --name-only --get-regexp '^shuttle\.deploy\..+\.host$' 2>/dev/null | sed -e 's/^shuttle\.deploy\.//' -e 's/\.host$//' | sort -u
}

# --- validation: what goes to ssh, to the remote shell or to a ref is checked before anything is run ----------------------------

deploy_valid_name()     { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; }
# a host or an alias of ~/.ssh/config, with an optional user: it can never start with a dash (an ssh option)
deploy_valid_host()     { [[ "$1" =~ ^([A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.:-]*$ ]]; }
deploy_valid_port()     { [[ "$1" =~ ^[0-9]{1,5}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 )); }
deploy_valid_modules()  { [[ "$1" =~ ^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$ ]]; }
deploy_valid_branch()   { [[ -n "$1" && "$1" != -* ]] && git check-ref-format --branch "$1" >/dev/null 2>&1; }
# one line, no control character
deploy_valid_command()  { [[ -n "$1" && "$1" != *[[:cntrl:]]* && "$1" != -* ]]; }

# deploy_load TARGET — sets the DEPLOY_* variables from the saved target, or stops saying what to fix. Call it directly, never in $( ).
# shellcheck disable=SC2034  # read by the commands
deploy_load() {
    local t=$1
    deploy_valid_name "$t" || die "'$t' is not a target name (lowercase letters, digits, - and _)"
    [[ -n "$(deploy_cfg "$t" host)" ]] || die "no target '$t': git shuttle deploy --setup $t   (saved: $(deploy_targets | paste -sd' ' -))"
    DEPLOY_TARGET=$t
    DEPLOY_HOST=$(deploy_cfg "$t" host); DEPLOY_PORT=$(deploy_cfg "$t" port)
    DEPLOY_COMMAND=$(deploy_cfg "$t" command); DEPLOY_BRANCH=$(deploy_cfg "$t" branch)
    DEPLOY_SUDO=$(deploy_cfg "$t" sudo); DEPLOY_SUDO=${DEPLOY_SUDO:-none}
    DEPLOY_DETECTOR=$(deploy_cfg "$t" detector); DEPLOY_DETECTOR=${DEPLOY_DETECTOR:-none}
    DEPLOY_CONFIRM=$(deploy_cfg "$t" confirm); DEPLOY_CONFIRM=${DEPLOY_CONFIRM:-none}
    deploy_valid_host "$DEPLOY_HOST" || die "target '$t': the host '$DEPLOY_HOST' is not valid (user@host, or an alias of ~/.ssh/config)"
    [[ -z "$DEPLOY_PORT" ]] || deploy_valid_port "$DEPLOY_PORT" || die "target '$t': the port '$DEPLOY_PORT' is not valid"
    deploy_valid_command "$DEPLOY_COMMAND" || die "target '$t': no valid command (one line, not starting with a dash): git shuttle deploy --setup $t --command '...'"
    deploy_valid_branch "$DEPLOY_BRANCH" || die "target '$t': the branch '$DEPLOY_BRANCH' is not valid: git shuttle deploy --setup $t --branch <branch>"
    [[ "$DEPLOY_SUDO" == none || "$DEPLOY_SUDO" == ask ]] || die "target '$t': sudo must be none or ask, not '$DEPLOY_SUDO'"
    [[ "$DEPLOY_DETECTOR" == none || "$DEPLOY_DETECTOR" == odoo ]] || die "target '$t': detector must be none or odoo, not '$DEPLOY_DETECTOR'"
    [[ "$DEPLOY_CONFIRM" == none || "$DEPLOY_CONFIRM" == name ]] || die "target '$t': confirm must be none or name, not '$DEPLOY_CONFIRM'"
}

# --- what was deployed, and which modules changed -------------------------------------------------------------------------------

deploy_state_dir() { printf '%s/shuttle-deploy' "$(git rev-parse --path-format=absolute --git-common-dir)"; }

# deploy_last TARGET — the commit the last successful deploy of the target reached (empty when none, or when it is gone).
deploy_last() {
    local file sha=""
    file="$(deploy_state_dir)/$1.last"
    [[ -f "$file" ]] && sha=$(head -n1 "$file")
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$sha^{commit}" 2>/dev/null && printf '%s' "$sha"
    return 0
}

# deploy_record TARGET SHA MODULES RESULT — remembers the commit (on success) and appends a line to the log of the target.
deploy_record() {
    local dir; dir=$(deploy_state_dir)
    mkdir -p "$dir" 2>/dev/null || return 0
    [[ "$4" == ok ]] && printf '%s\n' "$2" >"$dir/$1.last"
    printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:0:12}" "$3" "$4" >>"$dir/$1.log"
}

# deploy_modules_odoo FROM TO — the Odoo modules (top-level folders with a __manifest__.py at TO) that changed from FROM to TO.
deploy_modules_odoo() {
    local path dir seen=" " out=()
    while IFS= read -r -d '' path; do
        [[ "$path" == */* ]] || continue
        dir=${path%%/*}
        [[ "$seen" == *" $dir "* ]] && continue
        seen+="$dir "
        [[ "$dir" =~ ^[A-Za-z0-9_]+$ ]] && git cat-file -e "$2:$dir/__manifest__.py" 2>/dev/null && out+=("$dir")
    done < <(git diff --name-only -z "$1" "$2" 2>/dev/null)
    (IFS=,; printf '%s' "${out[*]-}")
}

# --- ssh ---------------------------------------------------------------------------------------------------------------------------

# deploy_ssh_prefix — fills DEPLOY_SSH with the program and its options (the target comes after "--").
# On a terminal ssh may ask for the login password itself, once: the connection is shared by the calls that follow (the same way as
# odoo-mirror), and git-shuttle never reads that password. Without a terminal ssh must not ask (BatchMode): a key or nothing.
deploy_ssh_prefix() {
    DEPLOY_SSH=("${GIT_SHUTTLE_SSH:-ssh}" -o ConnectTimeout=10 -o ServerAliveInterval=30)
    if [[ -t 0 ]]; then
        DEPLOY_CTL="${XDG_RUNTIME_DIR:-/tmp}/git-shuttle-$$-%C"
        DEPLOY_SSH+=(-o ControlMaster=auto -o "ControlPath=$DEPLOY_CTL" -o ControlPersist=60)
    else
        DEPLOY_CTL=""
        DEPLOY_SSH+=(-o BatchMode=yes)
    fi
    [[ -z "$DEPLOY_PORT" ]] || DEPLOY_SSH+=(-p "$DEPLOY_PORT")
}

# deploy_close — ends the shared connection (it would end by itself a minute after the last use).
deploy_close() {
    [[ -n "${DEPLOY_CTL:-}" ]] || return 0
    deploy_ssh_prefix
    "${DEPLOY_SSH[@]}" -O exit -- "$DEPLOY_HOST" >/dev/null 2>&1 || true
}

# deploy_remote_command MODULES — the command line the server runs: the template with {modules} replaced.
deploy_remote_command() {
    local c=$DEPLOY_COMMAND
    printf '%s' "${c//\{modules\}/$1}"
}

# deploy_need_user — a server saved without a user: on a terminal the user is asked for (the way odoo-mirror asks), and kept once the
# login worked. Enter leaves it to ssh (your own user name, or the User of ~/.ssh/config).
DEPLOY_USER_ASKED=0
deploy_need_user() {
    [[ "$DEPLOY_HOST" != *@* && -t 0 ]] && (( ! DRY_RUN )) || return 0
    local user=""
    ask user "User on $DEPLOY_HOST (Enter: ssh decides: your own user name, or ~/.ssh/config)" ""
    [[ -n "$user" ]] || return 0
    deploy_valid_host "$user@$DEPLOY_HOST" || die "the user '$user' is not valid"
    DEPLOY_HOST="$user@$DEPLOY_HOST"
    DEPLOY_USER_ASKED=1
}

# deploy_keep_user — the login worked with the user that was asked for: it is saved with the server (it is not a secret).
deploy_keep_user() {
    (( DEPLOY_USER_ASKED )) || return 0
    git config "shuttle.deploy.$DEPLOY_TARGET.host" "$DEPLOY_HOST" && info "saved the user: $DEPLOY_HOST"
    DEPLOY_USER_ASKED=0
}

# deploy_check_ssh — the server answers (it may ask for the login password here, on the terminal), and nothing else is run; stops with a hint.
deploy_check_ssh() {
    deploy_ssh_prefix
    local err rc
    err=$("${DEPLOY_SSH[@]}" -- "$DEPLOY_HOST" true 2>&1 >/dev/null); rc=$?
    (( rc == 0 )) && return 0
    err=$(printf '%s' "$err" | tr -d '\r' | grep -v '^$' | head -n 2 | paste -sd' ' -)
    case "$err" in
        *"Permission denied"*)
            if [[ -t 0 ]]; then
                if [[ "$DEPLOY_HOST" != *@* ]]; then
                    die "the login to $DEPLOY_HOST was refused, and the server has no user: ssh used your own user name here. Write it as user@host (git shuttle deploy --setup $DEPLOY_TARGET --host odooAdmin@$DEPLOY_HOST), or set User in ~/.ssh/config. $err"
                fi
                die "the login to $DEPLOY_HOST was refused: wrong password, or not the right user (the user is the part before the @ of the server). $err"
            fi
            die "ssh to $DEPLOY_HOST was refused: without a terminal it can only use a key (ssh-add it, or give the password in the web UI). $err" ;;
        *"Host key verification failed"*)  die "the host key of $DEPLOY_HOST is not trusted yet: run  ssh $DEPLOY_HOST  once to check it. $err" ;;
        *"Could not resolve"*|*"No route"*|*"timed out"*|*"refused"*) die "cannot reach $DEPLOY_HOST (is the VPN on? is the address right?). $err" ;;
        *) die "ssh to $DEPLOY_HOST failed (exit $rc). ${err:-no message}" ;;
    esac
}

# --- the plan ------------------------------------------------------------------------------------------------------------------------

# deploy_plan MODULES_OVERRIDE — fetches, checks the branch, and sets DEPLOY_TIP, DEPLOY_SUBJECT, DEPLOY_FROM, DEPLOY_MODULES and DEPLOY_REMOTE.
# shellcheck disable=SC2034  # read by the commands
deploy_plan() {
    local override=$1 remote ref
    remote=$(cfg_remote)
    fetch_remote
    ref="refs/remotes/$remote/$DEPLOY_BRANCH"
    have_ref "$ref" || die "the branch '$DEPLOY_BRANCH' is not on '$remote': the server has nothing to update to (push it first)"
    # your own branch of that name must be on the remote too: the server only gets what was pushed
    if have_ref "refs/heads/$DEPLOY_BRANCH"; then
        local ahead; ahead=$(git rev-list --count "$ref..refs/heads/$DEPLOY_BRANCH" 2>/dev/null || echo 0)
        (( ahead == 0 )) || die "'$DEPLOY_BRANCH' has $ahead commit(s) that are not on '$remote' yet: the server would not get them (git shuttle push)"
    fi
    DEPLOY_TIP=$(git rev-parse "$ref")
    DEPLOY_SUBJECT=$(git log -1 --format=%s "$ref")
    DEPLOY_FROM=$(deploy_last "$DEPLOY_TARGET")
    local base=$DEPLOY_FROM
    if [[ -z "$base" ]]; then
        # never deployed from here: the last change of the branch (a merge commit counts as one change)
        base=$(git rev-parse -q --verify "$DEPLOY_TIP^1" 2>/dev/null || git hash-object -t tree /dev/null)
    fi
    if [[ -n "$override" ]]; then
        deploy_valid_modules "$override" || die "the modules '$override' are not valid: names separated by commas (for example sale_documents,custom_technicien)"
        DEPLOY_MODULES=$override
    elif [[ "$DEPLOY_DETECTOR" == odoo ]]; then
        DEPLOY_MODULES=$(deploy_modules_odoo "$base" "$DEPLOY_TIP")
    else
        DEPLOY_MODULES=""
    fi
    DEPLOY_NEEDS_MODULES=0
    [[ "$DEPLOY_COMMAND" == *"{modules}"* && -z "$DEPLOY_MODULES" ]] && DEPLOY_NEEDS_MODULES=1
    DEPLOY_REMOTE=$(deploy_remote_command "$DEPLOY_MODULES")
}

# deploy_need_modules — a command with {modules} cannot run without them: stops saying how to name them.
deploy_need_modules() {
    [[ "$DEPLOY_COMMAND" == *"{modules}"* && -z "$DEPLOY_MODULES" ]] || return 0
    local since="in the last change of '$DEPLOY_BRANCH'"
    [[ -z "$DEPLOY_FROM" ]] || since="since the last deploy"
    die "no module to update: none changed $since. Name them: git shuttle deploy $DEPLOY_TARGET --modules a,b"
}

deploy_show_plan() {
    show_where "$BRANCH"
    info "target:     ${C_BLD}$DEPLOY_TARGET${C_OFF}  ($DEPLOY_HOST${DEPLOY_PORT:+:$DEPLOY_PORT})"
    info "deploys:    $(cfg_remote)/$DEPLOY_BRANCH at ${DEPLOY_TIP:0:9}  $DEPLOY_SUBJECT"
    if [[ -n "$DEPLOY_FROM" ]]; then
        info "since:      the last deploy from here, ${DEPLOY_FROM:0:9} ($(git rev-list --count "$DEPLOY_FROM..$DEPLOY_TIP" 2>/dev/null || echo '?') commits)"
        git log --format='              %h %s' -n 8 "$DEPLOY_FROM..$DEPLOY_TIP" 2>/dev/null
    else
        info "since:      (no deploy of this target was made from here before)"
    fi
    if [[ -n "$DEPLOY_MODULES" ]]; then info "modules:    $DEPLOY_MODULES"
    elif [[ "$DEPLOY_COMMAND" == *"{modules}"* ]]; then info "modules:    (none found: name them with --modules)"; fi
    info "runs:       ssh ${DEPLOY_HOST} $DEPLOY_REMOTE"
    [[ "$DEPLOY_SUDO" != ask ]] || info "sudo:       the server will ask for its password: type it at the prompt"
}

deploy_porcelain() {
    local kv
    for kv in "target=$DEPLOY_TARGET" "host=$DEPLOY_HOST" "port=$DEPLOY_PORT" "branch=$DEPLOY_BRANCH" "tip=$DEPLOY_TIP" \
              "subject=$DEPLOY_SUBJECT" "last=$DEPLOY_FROM" "modules=$DEPLOY_MODULES" "command=$DEPLOY_REMOTE" \
              "sudo=$DEPLOY_SUDO" "confirm=$DEPLOY_CONFIRM" "detector=$DEPLOY_DETECTOR" "needs-modules=$DEPLOY_NEEDS_MODULES"; do
        printf '%s\0' "$kv"
    done
}

# --- setup, list, forget ------------------------------------------------------------------------------------------------------

# deploy_list [PORCELAIN] — the saved targets; porcelain: one record per target, fields separated by the unit separator.
deploy_list() {
    local t any=0 sep=$'\x1f' line time sha result
    if [[ "${1:-0}" == 1 ]]; then
        while read -r t; do
            [[ -n "$t" ]] || continue
            line=$(tail -n1 "$(deploy_state_dir)/$t.log" 2>/dev/null || true)
            IFS=$'\t' read -r time sha result <<<"$line"
            printf '%s\0' "target=$t$sep$(deploy_cfg "$t" host)$sep$(deploy_cfg "$t" port)$sep$(deploy_cfg "$t" command)$sep$(deploy_cfg "$t" branch)$sep$(deploy_cfg "$t" sudo)$sep$(deploy_cfg "$t" detector)$sep$(deploy_cfg "$t" confirm)$sep$time$sep$sha$sep$result"
        done < <(deploy_targets)
        return 0
    fi
    printf '%-14s %-28s %-22s %-6s %s\n' target host branch sudo "last deploy"
    while read -r t; do
        [[ -n "$t" ]] || continue
        any=1
        printf '%-14s %-28s %-22s %-6s %s\n' "$t" "$(deploy_cfg "$t" host)" "$(deploy_cfg "$t" branch)" "$(deploy_cfg "$t" sudo)" \
            "$(tail -n1 "$(deploy_state_dir)/$t.log" 2>/dev/null | cut -f1,2,4 | tr '\t' ' ')"
    done < <(deploy_targets)
    (( any )) || info "No target yet: git shuttle deploy --setup staging"
}

deploy_forget() {
    local t=$1
    deploy_valid_name "$t" || die "'$t' is not a target name"
    [[ -n "$(deploy_cfg "$t" host)" ]] || die "no target '$t'"
    confirm "Forget the target '$t'? (its settings are removed; the server is not touched)"
    run git config --remove-section "shuttle.deploy.$t" || die "cannot remove the settings of '$t'"
    rm -f "$(deploy_state_dir)/$t.last" 2>/dev/null
    step "target '$t' removed"
}

# deploy_setup NAME FLAGS... — asks for what is missing (a flag answers its question), shows it, and saves it.
deploy_setup() {
    local name=$1; shift
    local host="" port="" command="" branch="" sudo="" detector="" require="" given_host=0
    while (( $# )); do
        case "$1" in
            --host)    [[ $# -ge 2 ]] || die "--host needs a value"; host=$2; given_host=1; shift 2 ;;
            --port)    [[ $# -ge 2 ]] || die "--port needs a number"; port=$2; shift 2 ;;
            --command) [[ $# -ge 2 ]] || die "--command needs a value"; command=$2; shift 2 ;;
            --branch)  [[ $# -ge 2 ]] || die "--branch needs a value"; branch=$2; shift 2 ;;
            --sudo)    [[ $# -ge 2 ]] || die "--sudo needs none or ask"; sudo=$2; shift 2 ;;
            --detector) [[ $# -ge 2 ]] || die "--detector needs none or odoo"; detector=$2; shift 2 ;;
            --require-name)    require=name; shift ;;
            --no-require-name) require=none; shift ;;
            *) die "deploy --setup: unknown argument '$1'" ;;
        esac
    done
    need_repo
    load_branches
    if [[ -z "$name" ]]; then ask name "Name of the target (staging, production...)" ""; fi
    [[ -n "$name" ]] || die "no name: git shuttle deploy --setup <name>"
    deploy_valid_name "$name" || die "'$name' is not a target name (lowercase letters, digits, - and _)"

    (( given_host )) || [[ -n "$host" ]] || ask host "Server (user@host, or an alias of ~/.ssh/config)" "$(deploy_cfg "$name" host)"
    deploy_valid_host "$host" || die "the server '$host' is not valid: user@host, or an alias of ~/.ssh/config (it cannot start with a dash)"
    [[ -n "$port" ]] || ask port "ssh port (empty: the default)" "$(deploy_cfg "$name" port)"
    [[ -z "$port" ]] || deploy_valid_port "$port" || die "the port '$port' is not valid"
    [[ -n "$command" ]] || ask command "Command that updates the server ({modules} = the modules that changed)" "$(deploy_cfg "$name" command)"
    deploy_valid_command "$command" || die "give the command the server runs (one line, not starting with a dash), for example: staging-update {modules}"
    local default_branch; default_branch=$(deploy_cfg "$name" branch); default_branch=${default_branch:-$INTEGRATION}
    [[ -n "$branch" ]] || ask branch "Branch the server runs" "$default_branch"
    deploy_valid_branch "$branch" || die "the branch '$branch' is not valid"
    local default_sudo; default_sudo=$(deploy_cfg "$name" sudo); default_sudo=${default_sudo:-none}
    [[ -n "$sudo" ]] || ask sudo "Does the server ask for a sudo password? (none = no, ask = yes: you type it at the prompt)" "$default_sudo"
    [[ "$sudo" == none || "$sudo" == ask ]] || die "sudo must be none or ask"
    local default_detector; default_detector=$(deploy_cfg "$name" detector); default_detector=${default_detector:-none}
    [[ -n "$detector" ]] || ask detector "Find the modules that changed? (odoo = folders with a __manifest__.py, none)" "$default_detector"
    [[ "$detector" == none || "$detector" == odoo ]] || die "detector must be none or odoo"
    if [[ -z "$require" ]]; then
        # a branch that is a release branch (or the base) is production: the name of the target is typed before every deploy
        local default_require=none
        [[ "$branch" == "$RELEASE" || "$branch" == "$BASE" ]] && [[ "$branch" != "$INTEGRATION" ]] && default_require=name
        [[ "$(deploy_cfg "$name" confirm)" == name ]] && default_require=name
        ask require "Type the name of the target before each deploy? (name = yes, none = no; use it for production)" "$default_require"
    fi
    [[ "$require" == none || "$require" == name ]] || die "the answer must be name or none"

    info "target:     $name"
    info "server:     $host${port:+ (port $port)}"
    info "command:    $command"
    info "branch:     $branch"
    info "sudo:       $sudo"
    info "modules:    $detector"
    info "typed name: $require"
    confirm "Save this target in this repository?"
    local key value
    for key in "${DEPLOY_KEYS[@]}"; do
        case "$key" in
            host) value=$host ;; port) value=$port ;; command) value=$command ;; branch) value=$branch ;;
            sudo) value=$sudo ;; detector) value=$detector ;; confirm) value=$require ;;
        esac
        if [[ -n "$value" ]]; then run git config "shuttle.deploy.$name.$key" "$value" || die "cannot save the setting '$key'"
        else run git config --unset "shuttle.deploy.$name.$key" 2>/dev/null || true; fi
    done
    step "target '$name' saved: git shuttle deploy $name"
}

# --- the command --------------------------------------------------------------------------------------------------------------------

cmd_deploy() {
    local target="" modules="" confirm_name="" plan=0 check=0 porcelain=0 mode="" setup_args=()
    while (( $# )); do
        case "$1" in
            --modules)  [[ $# -ge 2 ]] || die "--modules needs names separated by commas"; modules=$2; shift 2 ;;
            --confirm)  [[ $# -ge 2 ]] || die "--confirm needs the name of the target"; confirm_name=$2; shift 2 ;;
            --plan)     plan=1; shift ;;
            --check)    check=1; shift ;;
            --porcelain) porcelain=1; shift ;;
            --list)     mode=list; shift ;;
            --setup)    mode=setup; shift ;;
            --forget)   mode=forget; shift ;;
            --host|--port|--command|--branch|--sudo|--detector)
                [[ $# -ge 2 ]] || die "$1 needs a value"; setup_args+=("$1" "$2"); shift 2 ;;
            --require-name|--no-require-name) setup_args+=("$1"); shift ;;
            -*) die "deploy: unknown argument '$1'" ;;
            *)  [[ -z "$target" ]] || die "deploy: one target at a time ('$target' and '$1')"; target=$1; shift ;;
        esac
    done
    need_repo
    case "$mode" in
        list)   deploy_list "$porcelain"; return 0 ;;
        setup)  deploy_setup "$target" "${setup_args[@]+"${setup_args[@]}"}"; return 0 ;;
        forget) [[ -n "$target" ]] || die "deploy --forget needs the name of a target"; deploy_forget "$target"; return 0 ;;
    esac
    (( ${#setup_args[@]} == 0 )) || die "deploy: ${setup_args[0]} is for --setup"
    refuse_operation
    # a deploy needs no branch of yours: it is about what is on the remote
    BRANCH=$(git symbolic-ref -q --short HEAD 2>/dev/null || echo '(detached HEAD)')
    load_branches

    if [[ -z "$target" ]]; then
        local names; names=$(deploy_targets)
        case "$(printf '%s' "$names" | grep -c .)" in
            0) die "no deploy target in this repository yet: git shuttle deploy --setup staging" ;;
            1) target=$names ;;
            *) die "which server? git shuttle deploy <$(printf '%s' "$names" | paste -sd'|' -)>" ;;
        esac
    fi
    deploy_load "$target"
    deploy_plan "$modules"

    if (( plan )); then
        if (( porcelain )); then deploy_porcelain; else deploy_show_plan; fi
        return 0
    fi
    if [[ "$DEPLOY_SUDO" == ask && ! -t 0 ]] && (( ! DRY_RUN && ! check )); then
        die "the server asks for a sudo password: run it in a terminal, or give it in the web UI"
    fi
    deploy_need_user
    if (( check )); then
        trap deploy_close EXIT
        (( DRY_RUN )) || deploy_check_ssh
        deploy_keep_user
        step "ssh to $DEPLOY_HOST works (it was not asked to do anything)"
        return 0
    fi

    deploy_need_modules
    deploy_show_plan
    # the name is typed (or given with --confirm): --yes alone never deploys to a target that asks for it
    if [[ "$DEPLOY_CONFIRM" == name ]] && (( ! DRY_RUN )); then
        if [[ -z "$confirm_name" ]]; then
            [[ -t 0 ]] || die "'$DEPLOY_TARGET' asks for its name before a deploy: add  --confirm $DEPLOY_TARGET"
            read -r -p "Type '$DEPLOY_TARGET' to deploy: " confirm_name
        fi
        [[ "$confirm_name" == "$DEPLOY_TARGET" ]] || { info "Declined: nothing was changed."; exit "$EX_DECLINED"; }
    else
        confirm "Deploy '$DEPLOY_TARGET' ($DEPLOY_HOST)?"
    fi
    trap deploy_close EXIT
    (( DRY_RUN )) || deploy_check_ssh
    deploy_keep_user

    deploy_ssh_prefix
    # on a terminal the server gets one too: a command that asks for a password (sudo) can, and a login shell can run an alias
    local tty=-T; [[ "$DEPLOY_SUDO" == ask || -t 0 ]] && tty=-t
    if run "${DEPLOY_SSH[@]}" "$tty" -- "$DEPLOY_HOST" "$DEPLOY_REMOTE"; then
        (( DRY_RUN )) || deploy_record "$DEPLOY_TARGET" "$DEPLOY_TIP" "$DEPLOY_MODULES" ok
        step "deployed to '$DEPLOY_TARGET'"
    else
        local rc=$?
        deploy_record "$DEPLOY_TARGET" "$DEPLOY_TIP" "$DEPLOY_MODULES" "failed($rc)"
        if (( rc == 127 )); then
            stop "the server did not find the command (exit 127): nothing ran there. If you type it fine in your own login, it is an alias or a function of the shell of that login (ssh does not load them) or a folder that only that login has in its PATH: on the server run  type -a ${DEPLOY_COMMAND%% *}  and use the full path, or  bash -ic '${DEPLOY_COMMAND}'  as the command of the target (git shuttle deploy --setup $DEPLOY_TARGET --command ...)."
        fi
        stop "the command on '$DEPLOY_TARGET' failed (exit $rc): the server may be half way. Read its output above, fix it, and run  git shuttle deploy $DEPLOY_TARGET  again."
    fi
}
