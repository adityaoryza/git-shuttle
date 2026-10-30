# shellcheck shell=bash
# git shuttle trace [list] [--porcelain] | show ID [--addon NAME] [--porcelain] | sync TASK --branch NAME
#
# What happened to a task, from its first commit to the deploy that carried it. A branch that was started from a task (git shuttle start --task N,
# with an add-on) remembers it; every step git-shuttle takes on that branch adds a line to <git dir>/shuttle-trace/events.jsonl: start (with what
# the add-on knew of the task that day), commit, push, pr, merge, release. A deploy is written without a task, and shows in the trace of the tasks
# whose merge it carried. The file is private to you and stays in the repository folder (.git): it is never pushed.
# Nothing here can stop a command: a trace that cannot be written is left out.

# trace_python — sets TRACE_PY (python3, or python); returns 1 when there is none. Never dies: the trace is not worth stopping a command for.
trace_python() {
    [[ -n "${TRACE_PY:-}" ]] && return 0
    local py
    for py in python3 python; do
        if "$py" -c '' >/dev/null 2>&1; then TRACE_PY=$py; return 0; fi
    done
    return 1
}

trace_file() {
    # a dry run of trace sync reads the report from a copy, so a merge that is only about to be recorded is in the preview
    if (( DRY_RUN )) && [[ -n "${TRACE_FILE_OVERRIDE:-}" ]]; then
        printf '%s\n' "$TRACE_FILE_OVERRIDE"
        return 0
    fi
    local dir
    dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
    printf '%s/shuttle-trace/events.jsonl' "$dir"
}

# trace_event TYPE BRANCH [key=value ...] — a step on a branch that is for a task (nothing when it is not).
trace_event() {
    local type=$1 branch=$2 addon id title link file
    shift 2
    (( DRY_RUN )) && return 0
    addon=$(git config --get "branch.$branch.shuttle-ref-addon" 2>/dev/null) || return 0
    id=$(git config --get "branch.$branch.shuttle-ref-id" 2>/dev/null) || return 0
    [[ -n "$addon" && -n "$id" ]] || return 0
    title=$(git config --get "branch.$branch.shuttle-ref-title" 2>/dev/null || true)
    link=$(git config --get "branch.$branch.shuttle-ref-link" 2>/dev/null || true)
    trace_python || return 0
    file=$(trace_file) || return 0
    "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" "${TRACE_VERB:-append}" "$file" "type=$type" "branch=$branch" "addon=$addon" "task=$id" "title=$title" "link=$link" "$@" 2>/dev/null || true
}

# trace_global TYPE [key=value ...] — a step that is not on one task (a deploy).
trace_global() {
    local type=$1 file
    shift
    (( DRY_RUN )) && return 0
    trace_python || return 0
    file=$(trace_file) || return 0
    "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" append "$file" "type=$type" "$@" 2>/dev/null || true
}

# trace_sha REF — the commit of a reference, or nothing.
trace_sha() { git rev-parse --verify -q "$1^{commit}" 2>/dev/null || true; }

# trace_bind TASK ADDON BRANCH FORCE — a branch that already has commits is linked to a task: the branch remembers it, and what the branch already did
# (its start, its commits, the pull request and its merge) is written to the trace with the dates it really had. Nothing is written in a dry run.
trace_bind() {
    local task=$1 addon=$2 branch=$3 force=$4 name flag="" found=() base remote cur_addon cur_id
    need_repo
    refuse_operation
    load_branches
    branch=${branch:-$(git symbolic-ref -q --short HEAD || true)}
    [[ -n "$branch" ]] || die "bind: you are not on a branch: name it with --branch"
    git show-ref -q --verify "refs/heads/$branch" || die "bind: there is no branch '$branch' here"
    if [[ "$branch" == "$BASE" || "$branch" == "$INTEGRATION" || "$branch" == "$RELEASE" ]] || is_protected "$branch"; then
        die "bind: '$branch' is a shared branch, not the work of one task"
    fi
    if [[ -z "$addon" ]]; then
        while IFS= read -r name; do
            [[ -n "$name" ]] || continue
            addon_usable "$name" start && addon_cfg_all "$name" flags | grep -q '^start:--' && found+=("$name")
        done < <(addon_names)
        (( ${#found[@]} )) || die "bind: no enabled add-on knows tasks (git shuttle addon list)"
        (( ${#found[@]} == 1 )) || die "bind: several add-ons know tasks (${found[*]}): say which with --addon"
        addon=${found[0]}
    fi
    addon_usable "$addon" start || die "bind: the add-on '$addon' is not enabled for 'start' (git shuttle addon list)"
    flag=$(addon_cfg_all "$addon" flags | sed -n 's/^start:--//p' | head -n1)
    [[ -n "$flag" ]] || die "bind: the add-on '$addon' has no flag to name a task"
    cur_addon=$(git config --get "branch.$branch.shuttle-ref-addon" 2>/dev/null || true)
    cur_id=$(git config --get "branch.$branch.shuttle-ref-id" 2>/dev/null || true)

    addon_hook "$addon" start "arg.$flag=$task" "repo.root=$REPO_ROOT" "repo.name=$REPO_NAME" "repo.branch_prefix=$(cfg branchPrefix)" || die "the add-on '$addon': $ADDON_PROBLEM"
    local ref_id ref_title ref_link detail_line ref_trace=()
    ref_id=$(addon_rec ref-id); ref_title=$(addon_rec ref-title); ref_link=$(addon_rec ref-link)
    [[ -n "$ref_id" ]] || die "the add-on '$addon' did not say which task '$task' is"
    while IFS= read -r detail_line; do
        [[ -n "$detail_line" ]] && ref_trace+=("d.${detail_line%%$'\x1f'*}=${detail_line#*$'\x1f'}")
    done < <(addon_rec_all ref-detail)
    addon_cleanup
    if [[ -n "$cur_id" && ( "$cur_id" != "$ref_id" || "$cur_addon" != "$addon" ) ]] && ! (( force )); then
        die "bind: '$branch' is already for $cur_addon #$cur_id; use --force to link it to #$ref_id instead"
    fi
    remote=$(cfg_remote)
    base="$remote/$INTEGRATION"
    have_ref "refs/remotes/$base" || base=$INTEGRATION
    local count
    count=$(git rev-list --count "$base..$branch" 2>/dev/null || echo 0)
    (( count <= 150 )) || (( force )) || die "bind: '$branch' has $count commits that $base does not have: it does not look like the work of one task (use --force if it is)"
    info "branch:     $branch"
    info "for:        $addon #$ref_id${ref_title:+  $ref_title}"
    info "history:    $count commit(s) not in $base${count:+; the pull request and its merge are added when gh finds them}"
    confirm "Link '$branch' to the task #$ref_id?"
    if (( DRY_RUN )); then
        [[ -n "${TRACE_FILE_OVERRIDE:-}" ]] || return 0
    else
        git config "branch.$branch.shuttle-ref-addon" "$addon"
        git config "branch.$branch.shuttle-ref-id" "$ref_id"
        git config "branch.$branch.shuttle-ref-title" "$ref_title"
        git config "branch.$branch.shuttle-ref-link" "$ref_link"
    fi
    trace_python || { warn "the trace cannot be written (no python3): the branch is linked, its past is not recorded"; return 0; }
    local file pr_file="" gh=${GIT_SHUTTLE_GH:-gh} who summary
    file=$(trace_file) || return 0
    if command -v "$gh" >/dev/null 2>&1; then
        pr_file=$(mktemp)
        "$gh" pr view "$branch" --json url,state,title,baseRefName,createdAt,mergedAt,mergeCommit,commits >"$pr_file" 2>/dev/null || : >"$pr_file"
    fi
    who=$("$TRACE_PY" -I -c 'import json,sys; print(json.dumps(dict(zip(("addon","task","title","link","branch"), sys.argv[1:]))))' "$addon" "$ref_id" "$ref_title" "$ref_link" "$branch")
    summary=$(TRACE_BASE=$base TRACE_PR=$pr_file "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" backfill "$file" "$who" "$REPO_ROOT" 2>&1) || warn "the past of the branch could not be recorded: $summary"
    [[ -z "$pr_file" ]] || rm -f "$pr_file"
    TRACE_VERB=append-once trace_event bind "$branch" "linked=later" "${ref_trace[@]}"
    (( DRY_RUN )) || step "'$branch' is linked to $addon #$ref_id"
    info "recorded: $summary"
}

# trace_report_branch BRANCH — the Customer report of the task this branch is for.
trace_report_branch() {
    local rtarget=$1 rpr
    load_branches
    [[ -n "$rtarget" ]] || die "report: you are not on a branch: name it with --branch"
    report_applicable "$rtarget" || die "report: '$rtarget' is not for a task whose add-on has the report turned on (git shuttle addon report NAME on)"
    rpr=$(mktemp)
    "${GIT_SHUTTLE_GH:-gh}" pr view "$rtarget" --json url,number,title,baseRefName,commits >"$rpr" 2>/dev/null || : >"$rpr"
    if [[ ! -s "$rpr" ]] && ! report_has_steps "$REPORT_ADDON" "$REPORT_ID"; then
        rm -f "$rpr"; die "report: there is no pull request for '$rtarget' and the trace has no step of the task (git shuttle pr, or git shuttle trace bind)"
    fi
    task_report_flow "$rtarget" "$INTEGRATION" "$rpr"
    rm -f "$rpr"
}

cmd_trace() {
    local sub=${1:-list} porcelain=0 id="" addon="" file branch="" force=0
    shift || true
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            --addon) [[ $# -ge 2 ]] || die "--addon needs a name"; addon=$2; shift 2 ;;
            --branch) [[ $# -ge 2 ]] || die "--branch needs a name"; branch=$2; shift 2 ;;
            --force) force=1; shift ;;
            -*) die "trace: unknown option '$1'" ;;
            *) [[ -z "$id" ]] || die "trace: one task at a time"; id=$1; shift ;;
        esac
    done
    need_repo
    trace_python || die "the trace needs python3 (the web UI needs it too)"
    file=$(trace_file) || die "cannot find the folder of the repository"
    case "$sub" in
        map)
            # for the graph of the web UI: which commits and branches are for a task
            local remote_ref
            remote_ref="$(cfg_remote)/$(cfg integration)"
            have_ref "refs/remotes/$remote_ref" || remote_ref=$(cfg integration)
            load_branches
            TRACE_SHARED="$BASE $INTEGRATION $RELEASE" TRACE_BASE=${remote_ref:-HEAD} "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" map "$file" "$REPO_ROOT"
            return 0 ;;
        report)
            # the pull request (when there is one) and the steps of the branch, added to the Customer report of its task (the same as after `git shuttle pr`)
            trace_report_branch "${branch:-$(git symbolic-ref -q --short HEAD || true)}"
            return 0 ;;
        sync)
            # record what the pull request already has (its merge), then write the Customer report from that trace
            [[ -n "$id" ]] || die "trace sync needs the task:  git shuttle trace sync TASK --branch NAME"
            [[ -n "$branch" ]] || die "trace sync needs the branch: --branch NAME"
            if (( DRY_RUN )); then
                local copy
                copy=$(mktemp)
                chmod 600 "$copy"
                [[ -s "$file" ]] && cp "$file" "$copy"
                trap 'rm -f "$copy"' EXIT
                TRACE_FILE_OVERRIDE=$copy
                trace_bind "$id" "$addon" "$branch" 0
                trace_report_branch "$branch"
                unset TRACE_FILE_OVERRIDE
                rm -f "$copy"
                return 0
            fi
            trace_bind "$id" "$addon" "$branch" 0
            trace_report_branch "$branch"
            return 0 ;;
        unbind)
            # a branch that was linked to a task by mistake: it forgets the task, and its steps leave the trace
            local target gone
            target=${branch:-$(git symbolic-ref -q --short HEAD || true)}
            [[ -n "$target" ]] || die "unbind: you are not on a branch: name it with --branch"
            git config --get "branch.$target.shuttle-ref-id" >/dev/null 2>&1 || die "unbind: '$target' is not linked to a task"
            info "branch:     $target"
            info "for:        $(git config --get "branch.$target.shuttle-ref-addon") #$(git config --get "branch.$target.shuttle-ref-id")"
            info "unlinking removes the task from the branch and its steps from the trace (the commits are not touched)"
            confirm "Unlink '$target' from its task?"
            (( DRY_RUN )) && return 0
            gone=$("$TRACE_PY" -I "$ROOT/lib/addons/trace.py" forget "$file" "$target")
            local key
            for key in addon id title link; do git config --unset "branch.$target.shuttle-ref-$key" 2>/dev/null || true; done
            step "'$target' is no longer linked to a task ($gone step(s) removed from the trace)"
            return 0 ;;
        bind)
            [[ -n "$id" ]] || die "trace bind needs the task:  git shuttle trace bind 15607 [--addon NAME] [--branch NAME]"
            trace_bind "$id" "$addon" "$branch" "$force"
            return 0 ;;
        list)
            [[ -z "$id" ]] || die "trace list takes no task (trace show ID)"
            if (( porcelain )); then "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" tasks "$file"; return 0; fi
            "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" tasks "$file" | "$TRACE_PY" -I -c '
import json, sys
from datetime import datetime
def local(s): return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
tasks = json.load(sys.stdin)["tasks"]
if not tasks:
    print("No task has been traced yet: start a branch from a task (git shuttle start --task N, with an add-on enabled).")
for t in tasks:
    print("%-8s %-10s %-20s %3d  %s" % (t["id"], t["addon"], local(t["last"]) + " " + t["last_type"], t["events"], t["title"]))'
            ;;
        show)
            [[ -n "$id" ]] || die "trace show needs the number of a task (git shuttle trace list)"
            if [[ -z "$addon" ]]; then
                addon=$("$TRACE_PY" -I "$ROOT/lib/addons/trace.py" tasks "$file" | "$TRACE_PY" -I -c '
import json, sys
print(next((t["addon"] for t in json.load(sys.stdin)["tasks"] if t["id"] == sys.argv[1]), ""))' "$id")
                [[ -n "$addon" ]] || die "no trace of the task '$id' in this repository (git shuttle trace list)"
            fi
            if (( porcelain )); then "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" show "$file" "$addon" "$id" --repo "$REPO_ROOT"; return 0; fi
            "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" show "$file" "$addon" "$id" --repo "$REPO_ROOT" | "$TRACE_PY" -I -c '
import json, sys
from datetime import datetime
data = json.load(sys.stdin)
task = data["task"]
print("task %s (%s): %s" % (task["id"], task["addon"], task["title"]))
if task["link"]:
    print(task["link"])
print("branches: " + ", ".join(task["branches"]))
print()
for e in data["events"]:
    when = datetime.fromisoformat(e["time"].replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    what = {"start": "started", "commit": "commit", "push": "pushed", "pr": "pull request", "merge": "merged", "release": "release", "deploy": "deployed", "bind": "linked"}.get(e["type"], e["type"])
    extra = " ".join("%s=%s" % (k, v) for k, v in e.items() if k in ("sha", "into", "release_branch", "target", "url", "subject", "base") and v)
    print("%s  %-13s %s" % (when, what, extra.strip()))
    for k, v in (e.get("details") or {}).items():
        print("                         %s: %s" % (k, v))'
            ;;
        *) die "trace: '$sub' is not a command (list, show, bind, unbind, sync, report, map)" ;;
    esac
}
