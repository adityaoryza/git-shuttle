# shellcheck shell=bash
# git shuttle link COMMIT — the web address of a commit on the remote's hosting service (GitHub, GitLab, Bitbucket)
#
# Whatever the remote's address says about the user (name, password, token) is removed first: the result is safe to share.

# web_url_of REMOTE_URL — https://host/owner/repo, without credentials and without .git; empty when it cannot tell.
web_url_of() {
    local url=$1 host path
    case "$url" in
        http://*|https://*|ssh://*|git://*)
            url=${url#*://}; url=${url#*@}; host=${url%%/*}; host=${host%%:*}; path=${url#*/} ;;
        *@*:*) url=${url#*@}; host=${url%%:*}; path=${url#*:} ;;
        *) return 0 ;;
    esac
    path=${path%.git}; path=${path%/}
    [[ -n "$host" && "$path" == */* && "$host" =~ ^[A-Za-z0-9.-]+$ ]] || return 0
    printf 'https://%s/%s' "$host" "$path"
}

cmd_link() {
    local target=""
    while (( $# )); do
        case "$1" in
            -*) die "link: unknown option '$1'" ;;
            *) [[ -z "$target" ]] || die "link: give one commit"; target=$1; shift ;;
        esac
    done
    [[ -n "$target" ]] || die "link needs a commit:  git shuttle link <commit>"
    need_repo
    need_commit "$target"
    local remote url web host
    remote=$(cfg_remote)
    url=$(git remote get-url "$remote" 2>/dev/null) || die "no remote named '$remote'"
    web=$(web_url_of "$url")
    [[ -n "$web" ]] || die "cannot tell the web address of '$remote': its URL is not a known hosting address"
    host=${web#https://}; host=${host%%/*}
    case "$host" in
        github.com|*github*) printf '%s/commit/%s\n' "$web" "$COMMIT" ;;
        gitlab.com|*gitlab*) printf '%s/-/commit/%s\n' "$web" "$COMMIT" ;;
        bitbucket.org|*bitbucket*) printf '%s/commits/%s\n' "$web" "$COMMIT" ;;
        *) die "cannot tell which hosting service '$host' is (only GitHub, GitLab and Bitbucket addresses are known)" ;;
    esac
}
