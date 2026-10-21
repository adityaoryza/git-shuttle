# shellcheck shell=bash
# git shuttle config — the effective settings

cmd_config() {
    need_repo
    local keys=(remote base integration release protected messagePattern forbidTrailers mergeStrategy branchPrefix releasePattern upgradeCommand)
    local key value
    printf '%-18s %s\n' "setting" "value"
    for key in "${keys[@]}"; do
        value=$(cfg "$key")
        if [[ -n "$value" ]]; then
            printf '%-18s %s\n' "$key" "$value"
        else
            case "$key" in
                remote)       value="$(cfg_remote) (default)" ;;
                base)         value="$(detect_base)"; value="${value:-(not found)} (detected)" ;;
                integration)  value="$(detect_base)"; value="${value:-(not found)} (default: base)" ;;
                release)      value="$(detect_base)"; value="${value:-(not found)} (default: base)" ;;
                protected)    value="$(protected_list 2>/dev/null) (default)" ;;
                mergeStrategy) value="noff (default)" ;;
                branchPrefix)  value="feature/ (default)" ;;
                releasePattern) value="release/{date}-v1.{n} (default)" ;;
                *)            value="(unset)" ;;
            esac
            printf '%-18s %s%s%s\n' "$key" "$C_DIM" "$value" "$C_OFF"
        fi
    done
    info ""
    info "Change one with:  git config shuttle.<setting> <value>   (add --global for every repository)"
}
