# shellcheck shell=bash
# The report of a task: after a pull request is opened, the add-on of the task may add the pull request and the commits to the Customer
# report of the task (odoo-task: the field x_customer_report), for the people who follow the work. It is off until the user turns it on for the
# repository (git shuttle addon report NAME on), it only ever ADDS (the add-on keeps what is there), the text is shown before it is written, and
# a failure never undoes the pull request: it says so, and `git shuttle trace report` tries again.

# report_applicable BRANCH — sets REPORT_ADDON and REPORT_ID; fails when the branch is not for a task, or the add-on has no report hook or is not turned on.
report_applicable() {
    REPORT_ADDON=$(git config --get "branch.$1.shuttle-ref-addon" 2>/dev/null || true)
    REPORT_ID=$(git config --get "branch.$1.shuttle-ref-id" 2>/dev/null || true)
    [[ -n "$REPORT_ADDON" && -n "$REPORT_ID" ]] || return 1
    addon_usable "$REPORT_ADDON" report || return 1
    [[ "$(addon_cfg "$REPORT_ADDON" report)" == on ]] || return 1
}

# report_call BRANCH BASE ACTION PRFILE — one call of the hook; the checked answer is in REPORT_ANSWER (JSON). Returns 1 with ADDON_PROBLEM.
report_call() {
    local branch=$1 base=$2 action=$3 pr_file=$4 input
    addon_need_python
    addon_cleanup
    input=$(mktemp)
    if ! "$ADDON_PY" -I "$ROOT/lib/addons/report.py" input "$action" "$REPO_ROOT" "$branch" "$base" "$REPO_NAME" "$REPORT_ID" ${pr_file:+"$pr_file"} >"$input" 2>/dev/null; then
        rm -f "$input"; ADDON_PROBLEM="the information for the report could not be put together"; return 1
    fi
    # shellcheck disable=SC2034  # read by addon_run
    ADDON_RUN_TIMEOUT=${GIT_SHUTTLE_ADDON_TASKS_TIMEOUT:-45}
    if addon_run "$REPORT_ADDON" "$input" hook report && addon_validate report; then
        REPORT_ANSWER=$(cat "$ADDON_NORM"); unset ADDON_RUN_TIMEOUT; rm -f "$input"; addon_cleanup; return 0
    fi
    unset ADDON_RUN_TIMEOUT
    rm -f "$input"
    return 1
}

# report_field JSON KEY — a value of the answer.
report_field() { printf '%s' "$1" | "$ADDON_PY" -I -c 'import json, sys; v = json.load(sys.stdin).get(sys.argv[1], ""); print(("yes" if v else "") if isinstance(v, bool) else v)' "$2"; }

# task_report_flow BRANCH BASE PRFILE — the preview, the question, and the write. A failure is a warning: the pull request is already open.
task_report_flow() {
    local branch=$1 base=$2 pr_file=$3 answer ok field text reply
    if ! report_call "$branch" "$base" preview "$pr_file"; then
        warn "the Customer report of task #$REPORT_ID: $ADDON_PROBLEM"; return 0
    fi
    answer=$REPORT_ANSWER
    ok=$(report_field "$answer" ok); field=$(report_field "$answer" field); text=$(report_field "$answer" text)
    if [[ -z "$ok" ]]; then warn "the Customer report of task #$REPORT_ID: $(report_field "$answer" message)"; return 0; fi
    info "report:     $REPORT_ADDON #$REPORT_ID, the field ${field:-of the report}: $(report_field "$answer" message)"
    if [[ -n "$text" ]]; then printf '%s\n' "$text" | sed 's/^/              | /' >&2; fi
    [[ -z "$(report_field "$answer" skipped)" ]] || return 0
    (( DRY_RUN )) && return 0
    if (( ! YES )); then
        if [[ ! -t 0 ]]; then warn "not written (no terminal to ask): git shuttle trace report"; return 0; fi
        read -r -p "Add this to the Customer report of task #$REPORT_ID? [Y/n] " reply
        [[ -z "$reply" || "$reply" =~ ^[Yy] ]] || { info "Not written: git shuttle trace report, when you want it."; return 0; }
    fi
    if report_call "$branch" "$base" post "$pr_file"; then
        answer=$REPORT_ANSWER
        if [[ -n "$(report_field "$answer" ok)" ]]; then step "Customer report of task #$REPORT_ID: $(report_field "$answer" message)"
        else warn "the Customer report of task #$REPORT_ID was not changed: $(report_field "$answer" message) (git shuttle trace report, to try again)"; fi
    else
        warn "the Customer report of task #$REPORT_ID was not changed: $ADDON_PROBLEM (git shuttle trace report, to try again)"
    fi
    return 0
}

# task_report_after_pr BRANCH BASE TITLE — called by `git shuttle pr` once the pull request is open (in a dry run: what would be added).
task_report_after_pr() {
    local branch=$1 base=$2 title=$3 pr_file gh=${GIT_SHUTTLE_GH:-gh}
    report_applicable "$branch" || return 0
    addon_need_python
    pr_file=$(mktemp)
    if (( DRY_RUN )); then
        "$ADDON_PY" -I -c 'import json, sys; print(json.dumps({"title": sys.argv[1], "baseRefName": sys.argv[2]}))' "$title" "$base" >"$pr_file"
    else
        "$gh" pr view "$branch" --json url,number,title,baseRefName >"$pr_file" 2>/dev/null || : >"$pr_file"
    fi
    task_report_flow "$branch" "$base" "$pr_file"
    rm -f "$pr_file"
}

# addon_report_toggle NAME on|off — the user turns the report on or off for this repository.
addon_report_toggle() {
    local name=$1 state=$2
    need_repo
    case "$state" in on|off) ;; *) die "addon report: say on or off (git shuttle addon report $name on)" ;; esac
    addon_usable "$name" report || die "the add-on '$name' is not enabled, or has no report (git shuttle addon list)"
    if (( DRY_RUN )); then
        info "the report of '$name' would be turned $state for this repository"
        [[ "$state" == off ]] || info "after a pull request it shows what it would add to the Customer report of the task, and asks; it only adds, what is there is kept"
        return 0
    fi
    git config "shuttle.addon.$name.report" "$state"
    step "the report of '$name' is $state for this repository"
    [[ "$state" == off ]] || info "after a pull request it shows what it would add to the Customer report of the task, and asks; it only adds, what is there is kept"
}
