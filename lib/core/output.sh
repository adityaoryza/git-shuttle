# shellcheck shell=bash
# Output, prompts and the command runner
#
# Sourced by bin/git-shuttle: it only defines functions and constants.

# shellcheck disable=SC2034  # printed by bin/git-shuttle
readonly SHUTTLE_VERSION="0.1.0"

# Flags set by the command line (see bin/git-shuttle).
YES=${GIT_SHUTTLE_YES:-0}
DRY_RUN=0

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
    C_RED=""; C_GRN=""; C_YEL=""; C_BLD=""; C_DIM=""; C_OFF=""
fi

# Exit codes: 0 done, 1 refused before changing anything, 2 stopped half way (a conflict), 3 declined at the prompt.
readonly EX_REFUSED=1 EX_STOPPED=2 EX_DECLINED=3

info() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s%s%s\n' "$C_GRN" "$C_OFF" "$C_BLD" "$*" "$C_OFF"; }
warn() { printf '%swarning:%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit "$EX_REFUSED"; }
# stop <message> — a command that stopped half way: the repository is left for you to finish.
stop() { printf '%sstopped:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit "$EX_STOPPED"; }

# shell_word WORD — the word as you would type it: bare when it is plain, in single quotes otherwise.
shell_word() {
    if [[ -n "$1" && "$1" =~ ^[A-Za-z0-9_@%+=:,./-]+$ ]]; then printf '%s' "$1"
    else printf "'%s'" "${1//\'/\'\\\'\'}"; fi
}

# run CMD... — prints a command that changes something, then runs it (unless --dry-run).
run() {
    local shown="" word
    for word in "$@"; do shown="$shown$(shell_word "$word") "; done
    printf '%s$ %s%s\n' "$C_DIM" "${shown% }" "$C_OFF"
    (( DRY_RUN )) && return 0
    "$@"
}

# confirm QUESTION — true when the user agrees. --yes agrees, --dry-run never asks, a pipe cannot answer.
confirm() {
    (( YES || DRY_RUN )) && return 0
    [[ -t 0 ]] || die "cannot ask '$1' without a terminal: run it in a terminal, or add --yes"
    local answer
    read -r -p "$1 [Y/n] " answer
    [[ -z "$answer" || "$answer" =~ ^[Yy] ]] || { info "Declined: nothing was changed."; exit "$EX_DECLINED"; }
}

# ask VARIABLE QUESTION DEFAULT — sets VARIABLE to what is typed; Enter, --yes, --dry-run or no terminal give the default.
ask() {
    local __name=$1 question=$2 default=${3:-} answer=""
    if (( YES || DRY_RUN )) || [[ ! -t 0 ]]; then
        printf -v "$__name" '%s' "$default"
        return 0
    fi
    read -r -p "$question${default:+ [$default]}: " answer
    printf -v "$__name" '%s' "${answer:-$default}"
}
