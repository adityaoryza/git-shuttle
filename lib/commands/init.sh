# shellcheck shell=bash
# git shuttle init [--integration B] [--release B] [--base B] [--protected "B B"] [--message-pattern RE]
#                  [--forbid-trailers "T T"] [--hook]
#
# Sets the shuttle.* settings of this repository in one go. It proposes what it detects; Enter keeps each proposal.
# Without a terminal (or with --yes) it takes the proposals and the flags without asking.

# first_existing_remote_branch CANDIDATE... — the first one that exists on the remote (prints nothing when none does).
first_existing_remote_branch() {
    local remote candidate; remote=$(cfg_remote)
    for candidate in "$@"; do
        have_ref "refs/remotes/$remote/$candidate" && { printf '%s' "$candidate"; return 0; }
    done
    return 0
}

cmd_init() {
    local base="" integration="" release="" protected="" pattern="" forbid="" hook=0
    local set_pattern=0 set_forbid=0 prefix="" release_pattern="" upgrade="" set_prefix=0 set_release_pattern=0 set_upgrade=0
    while (( $# )); do
        case "$1" in
            --base)            [[ $# -ge 2 ]] || die "--base needs a branch"; base=$2; shift 2 ;;
            --integration)     [[ $# -ge 2 ]] || die "--integration needs a branch"; integration=$2; shift 2 ;;
            --release)         [[ $# -ge 2 ]] || die "--release needs a branch"; release=$2; shift 2 ;;
            --protected)       [[ $# -ge 2 ]] || die "--protected needs a list of branches"; protected=$2; shift 2 ;;
            --message-pattern) [[ $# -ge 2 ]] || die "--message-pattern needs a regular expression"; pattern=$2; set_pattern=1; shift 2 ;;
            --forbid-trailers) [[ $# -ge 2 ]] || die "--forbid-trailers needs a list of trailer names"; forbid=$2; set_forbid=1; shift 2 ;;
            --branch-prefix)   [[ $# -ge 2 ]] || die "--branch-prefix needs a text"; prefix=$2; set_prefix=1; shift 2 ;;
            --release-pattern) [[ $# -ge 2 ]] || die "--release-pattern needs a text"; release_pattern=$2; set_release_pattern=1; shift 2 ;;
            --upgrade-command) [[ $# -ge 2 ]] || die "--upgrade-command needs a command"; upgrade=$2; set_upgrade=1; shift 2 ;;
            --hook)            hook=1; shift ;;
            *) die "init: unknown argument '$1'" ;;
        esac
    done
    need_repo

    local remote; remote=$(cfg_remote)
    git remote get-url "$remote" >/dev/null 2>&1 || die "no remote named '$remote': add one first (git remote add $remote <url>)"
    run git fetch --quiet "$remote" || die "cannot fetch from '$remote'"

    # What it proposes: flags, then what is already set, then what it can see on the remote.
    local detected
    detected=$(detect_base)
    base=${base:-${detected:-$(first_existing_remote_branch main master)}}
    [[ -n "$integration" ]] || integration=$(cfg integration)
    [[ -n "$integration" ]] || integration=$(first_existing_remote_branch staging develop development integration)
    [[ -n "$release" ]] || release=$(cfg release)
    [[ -n "$release" ]] || release=$(first_existing_remote_branch release master main)

    show_repo_line() { info "repository: ${C_BLD}${REPO_NAME}${C_OFF} ($REPO_ROOT)"; }
    show_repo_line
    ask base "Base branch (work starts from it)" "${base:-}"
    ask integration "Integration branch (features are merged into it)" "${integration:-$base}"
    ask release "Release branch (a release starts from it)" "${release:-$base}"
    [[ -n "$base" && -n "$integration" && -n "$release" ]] || die "the base, integration and release branches are needed: pass --base, --integration and --release"

    local name
    for name in "$base" "$integration" "$release"; do
        have_ref "refs/remotes/$remote/$name" || die "the branch '$name' does not exist on '$remote'"
    done

    # The branches no command here writes to: the three above, plus the usual names that exist on the remote.
    if [[ -z "$protected" ]]; then
        protected="$base $integration $release"
        for name in main master; do
            have_ref "refs/remotes/$remote/$name" && protected="$protected $name"
        done
        protected=$(printf '%s' "$protected" | tr ' ' '\n' | awk '!seen[$0]++' | paste -sd' ')
    fi
    (( set_pattern )) || ask pattern "Commit message pattern, a regular expression (Enter = none)" "$(cfg messagePattern)"
    (( set_forbid )) || ask forbid "Trailers a message may not have, e.g. Co-Authored-By (Enter = none)" "$(cfg forbidTrailers)"

    (( set_prefix )) || ask prefix "Branch prefix for new work, e.g. 19.0-feature/ (Enter = feature/)" "$(cfg branchPrefix)"
    (( set_release_pattern )) || ask release_pattern "Release branch name, {date} and {n} (Enter = release/{date}-v1.{n})" "$(cfg releasePattern)"
    (( set_upgrade )) || ask upgrade "Command to test with before a push, {modules} = changed modules (Enter = none)" "$(cfg upgradeCommand)"

    info ""
    info "base         $base"
    info "integration  $integration"
    info "release      $release"
    info "protected    $protected"
    info "pattern      ${pattern:-(none)}"
    info "forbidden    ${forbid:-(none)}"
    info "branch prefix ${prefix:-(default: feature/)}"
    info "release name  ${release_pattern:-(default: release/{date}-v1.{n})}"
    info "test command  ${upgrade:-(none)}"
    confirm "Save these settings in this repository?"

    run git config shuttle.base "$base"
    run git config shuttle.integration "$integration"
    run git config shuttle.release "$release"
    run git config shuttle.protected "$protected"
    if [[ -n "$pattern" ]]; then run git config shuttle.messagePattern "$pattern"; else run git config --unset shuttle.messagePattern || true; fi
    if [[ -n "$forbid" ]]; then run git config shuttle.forbidTrailers "$forbid"; else run git config --unset shuttle.forbidTrailers || true; fi
    if [[ -n "$prefix" ]]; then run git config shuttle.branchPrefix "$prefix"; else run git config --unset shuttle.branchPrefix || true; fi
    if [[ -n "$release_pattern" ]]; then run git config shuttle.releasePattern "$release_pattern"; else run git config --unset shuttle.releasePattern || true; fi
    if [[ -n "$upgrade" ]]; then run git config shuttle.upgradeCommand "$upgrade"; else run git config --unset shuttle.upgradeCommand || true; fi
    step "saved. Change one later with  git config shuttle.<setting> <value>"
    if (( hook )); then
        cmd_hook install
    elif [[ -n "$pattern$forbid" ]]; then
        info "Tip: git shuttle hook install  applies the message rules to plain git commit too."
    fi
}
