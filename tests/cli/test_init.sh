#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

sandbox_new
# a repository that has not been set up: the sandbox sets two settings, remove them
git config --unset shuttle.integration; git config --unset shuttle.release

# --- with flags, no questions ---------------------------------------------------------------------------------------
shuttle -y init --integration develop --release release
assert_status 0 "$RC" "init with flags"
assert_eq "main" "$(git config shuttle.base)" "...the base comes from the remote"
assert_eq "develop" "$(git config shuttle.integration)" "...the integration branch from the flag"
assert_eq "release" "$(git config shuttle.release)" "...the release branch from the flag"
assert_eq "main develop release" "$(git config shuttle.protected)" "...the protected list is the three branches, without repeats"
assert_eq "" "$(git config shuttle.messagePattern)" "...no message pattern unless asked"
assert_contains "$OUT" "saved" "...says it saved"

# --- what it detects, with nothing given ----------------------------------------------------------------------------
git config --unset-all shuttle.integration; git config --unset-all shuttle.release; git config --unset shuttle.protected; git config --unset shuttle.base
shuttle -y init
assert_status 0 "$RC" "init with nothing given"
assert_eq "develop" "$(git config shuttle.integration)" "...finds the staging-like branch (develop) on the remote"
assert_eq "release" "$(git config shuttle.release)" "...and the release branch"

# --- message rules and the hook --------------------------------------------------------------------------------------
shuttle -y init --integration develop --release release --message-pattern '^\[[A-Z]+\] .+' --forbid-trailers "Co-Authored-By" --hook
assert_status 0 "$RC" "init with rules and --hook"
assert_eq '^\[[A-Z]+\] .+' "$(git config shuttle.messagePattern)" "...saves the pattern"
assert_eq "Co-Authored-By" "$(git config shuttle.forbidTrailers)" "...and the trailers"
assert_eq "yes" "$([[ -x .git/hooks/commit-msg ]] && echo yes || echo no)" "...and installs the hook"
shuttle -y init --integration develop --release release
assert_eq '^\[[A-Z]+\] .+' "$(git config shuttle.messagePattern)" "running it again keeps the rules already set"
shuttle -y init --integration develop --release release --message-pattern "" --forbid-trailers ""
assert_eq "" "$(git config shuttle.messagePattern)$(git config shuttle.forbidTrailers)" "...and an empty value removes them"
rm -f .git/hooks/commit-msg

# --- refusals change nothing ---------------------------------------------------------------------------------------------
git config --unset-all shuttle.integration
shuttle -y init --integration nowhere --release release
assert_status 1 "$RC" "an integration branch the remote does not have"
assert_contains "$OUT" "'nowhere' does not exist on 'origin'" "...is named"
assert_eq "" "$(git config shuttle.integration)" "...and nothing was saved"
shuttle -y init --bogus
assert_status 1 "$RC" "an unknown flag"
before=$(git config --list | sort | md5sum)
shuttle -n init --integration develop --release release
assert_status 0 "$RC" "init --dry-run"
assert_contains "$OUT" "git config shuttle.integration develop" "...shows the commands"
assert_eq "$before" "$(git config --list | sort | md5sum)" "...and saves nothing"
git remote remove origin
shuttle -y init
assert_status 1 "$RC" "a repository without a remote"
assert_contains "$OUT" "no remote named 'origin'" "...is refused"

# --- the questions, answered at a terminal -------------------------------------------------------------------------------------
sandbox_new "second repo"
git config --unset shuttle.integration; git config --unset shuttle.release
with_tty "" "$SHUTTLE" init
assert_status 0 "$RC" "init at a terminal, pressing Enter at every question"
assert_eq "develop" "$(git config shuttle.integration)" "...Enter keeps what it proposed"
assert_contains "$OUT" "Integration branch (features are merged into it) [develop]" "...the proposal is shown in the question"
git config --unset shuttle.integration
with_tty "|release||||" "$SHUTTLE" init
assert_eq "release" "$(git config shuttle.integration)" "typing a branch name replaces the proposal"
with_tty "|||||n" "$SHUTTLE" init
assert_status 3 "$RC" "answering n to the last question"

finish
