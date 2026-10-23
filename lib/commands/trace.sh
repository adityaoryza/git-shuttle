# shellcheck shell=bash
# git shuttle trace [list] [--porcelain] | show ID [--addon NAME] [--porcelain]
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
    "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" append "$file" "type=$type" "branch=$branch" "addon=$addon" "task=$id" "title=$title" "link=$link" "$@" 2>/dev/null || true
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

cmd_trace() {
    local sub=${1:-list} porcelain=0 id="" addon="" file
    shift || true
    while (( $# )); do
        case "$1" in
            --porcelain) porcelain=1; shift ;;
            --addon) [[ $# -ge 2 ]] || die "--addon needs a name"; addon=$2; shift 2 ;;
            -*) die "trace: unknown option '$1'" ;;
            *) [[ -z "$id" ]] || die "trace: one task at a time"; id=$1; shift ;;
        esac
    done
    need_repo
    trace_python || die "the trace needs python3 (the web UI needs it too)"
    file=$(trace_file) || die "cannot find the folder of the repository"
    case "$sub" in
        list)
            [[ -z "$id" ]] || die "trace list takes no task (trace show ID)"
            if (( porcelain )); then "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" tasks "$file"; return 0; fi
            "$TRACE_PY" -I "$ROOT/lib/addons/trace.py" tasks "$file" | "$TRACE_PY" -I -c '
import json, sys
tasks = json.load(sys.stdin)["tasks"]
if not tasks:
    print("No task has been traced yet: start a branch from a task (git shuttle start --task N, with an add-on enabled).")
for t in tasks:
    print("%-8s %-10s %-20s %3d  %s" % (t["id"], t["addon"], t["last"].replace("T", " ")[:16] + " " + t["last_type"], t["events"], t["title"]))'
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
data = json.load(sys.stdin)
task = data["task"]
print("task %s (%s): %s" % (task["id"], task["addon"], task["title"]))
if task["link"]:
    print(task["link"])
print("branches: " + ", ".join(task["branches"]))
print()
for e in data["events"]:
    when = e["time"].replace("T", " ").replace("Z", " UTC")
    what = {"start": "started", "commit": "commit", "push": "pushed", "pr": "pull request", "merge": "merged", "release": "release", "deploy": "deployed"}.get(e["type"], e["type"])
    extra = " ".join("%s=%s" % (k, v) for k, v in e.items() if k in ("sha", "into", "release_branch", "target", "url", "subject", "base") and v)
    print("%s  %-13s %s" % (when, what, extra.strip()))
    for k, v in (e.get("details") or {}).items():
        print("                         %s: %s" % (k, v))'
            ;;
        *) die "trace: '$sub' is not a command (list, show)" ;;
    esac
}
