# shellcheck shell=bash
# git shuttle hook install|uninstall|status — a commit-msg hook that applies the message rules to every commit

readonly HOOK_MARK="# git-shuttle commit-msg hook"

hook_path() { printf '%s/commit-msg' "$(git rev-parse --git-path hooks)"; }

hook_is_ours() { [[ -f "$1" ]] && grep -qF "$HOOK_MARK" "$1"; }

cmd_hook() {
    local action=${1:-status}
    need_repo
    local file; file=$(hook_path)
    case "$action" in
        install)
            if [[ -e "$file" ]] && ! hook_is_ours "$file"; then
                die "a commit-msg hook already exists and is not git-shuttle's: $file"
            fi
            info "hook: $file"
            confirm "Install the commit-msg hook?"
            if (( ! DRY_RUN )); then
                mkdir -p "$(dirname "$file")"
                {
                    printf '#!/bin/sh\n%s\n' "$HOOK_MARK"
                    printf '# Applies shuttle.messagePattern and shuttle.forbidTrailers; does nothing when git-shuttle is not installed.\n'
                    printf 'command -v git-shuttle >/dev/null 2>&1 || exit 0\n'
                    # shellcheck disable=SC2016  # "$1" is for the hook to expand, not for this script
                    printf 'exec git-shuttle check-message "$1"\n'
                } > "$file"
                chmod +x "$file"
            fi
            step "installed"
            ;;
        uninstall)
            [[ -e "$file" ]] || { info "no commit-msg hook: nothing to remove."; return 0; }
            hook_is_ours "$file" || die "the commit-msg hook is not git-shuttle's: left alone ($file)"
            confirm "Remove the commit-msg hook?"
            run rm -f "$file"
            step "removed"
            ;;
        status)
            if hook_is_ours "$file"; then info "installed: $file"
            elif [[ -e "$file" ]]; then info "another commit-msg hook is in place: $file"
            else info "not installed"; fi
            ;;
        *) die "hook: expected install, uninstall or status" ;;
    esac
}
