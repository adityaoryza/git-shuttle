#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# git shuttle deploy, against a stand-in for ssh (GIT_SHUTTLE_SSH): no server, no network.
sandbox_new
SSHLOG="$SB/ssh.log"
FAKE="$SB/fakessh"
cat >"$FAKE" <<'EOF'
#!/usr/bin/env bash
# the stand-in for ssh: it logs the arguments, answers the check (the command "true") by FAKE_SSH_CHECK, and runs the "deploy" by FAKE_SSH_RC
{ printf 'CALL'; printf ' [%s]' "$@"; echo; } >>"$FAKE_SSH_LOG"
last="${*: -1}"
if [[ "$last" == true ]]; then
    case "${FAKE_SSH_CHECK:-ok}" in
        ok) exit 0 ;;
        deny) echo "deploy@host: Permission denied (publickey)." >&2; exit 255 ;;
        hostkey) echo "Host key verification failed." >&2; exit 255 ;;
        unreach) echo "ssh: Could not resolve hostname nowhere: Name or service not known" >&2; exit 255 ;;
        other) echo "kex_exchange_identification: read: Connection reset by peer" >&2; exit 255 ;;
    esac
fi
echo "server ran: $last"
exit "${FAKE_SSH_RC:-0}"
EOF
chmod +x "$FAKE"
export GIT_SHUTTLE_SSH="$FAKE" FAKE_SSH_LOG="$SSHLOG"
calls() { grep -c '^CALL' "$SSHLOG" 2>/dev/null || true; }
deploys() { grep -v '\[true\]$' "$SSHLOG" 2>/dev/null | grep -vc '\[-O\] \[exit\]' || true; }
reset_log() { : >"$SSHLOG"; }
reset_log

# modules on the remote: two Odoo modules and a folder that is not one
git -C "$WORK" fetch -q origin
git clone -q "$REMOTE" "$SB/other" 2>/dev/null
( cd "$SB/other" && git checkout -q develop && mkdir -p sale_documents custom_technicien docs \
    && echo "{}" > sale_documents/__manifest__.py && echo "{}" > custom_technicien/__manifest__.py && echo text > docs/readme.txt \
    && git add . && git commit -q -m "two modules and a folder" && git push -q origin develop )
rm -rf "$SB/other"

# --- nothing saved ----------------------------------------------------------------------------------------------------------------
shuttle deploy
assert_status 1 "$RC" "deploy without a target"
assert_contains "$OUT" "deploy --setup staging" "...says how to make one"
shuttle deploy --list
assert_contains "$OUT" "No target yet" "list: none yet"

# --- setup ------------------------------------------------------------------------------------------------------------------------------
shuttle -y deploy --setup staging --host deploy@203.0.113.10 --command 'staging-update {modules}' --branch develop --detector odoo
assert_status 0 "$RC" "setup with flags"
assert_eq "deploy@203.0.113.10" "$(git config shuttle.deploy.staging.host)" "...saves the host"
assert_eq "staging-update {modules}" "$(git config shuttle.deploy.staging.command)" "...and the command"
assert_eq "none" "$(git config shuttle.deploy.staging.sudo)" "...sudo defaults to none"
assert_eq "none" "$(git config shuttle.deploy.staging.confirm)" "...a branch that is not the release branch needs no typed name"
shuttle -y deploy --setup production --host prod-alias --command 'production-update {modules}' --branch release --detector odoo
assert_eq "name" "$(git config shuttle.deploy.production.confirm)" "setup: a release branch asks for the typed name by default"
shuttle deploy --list
assert_contains "$OUT" "staging" "list: the first target"
assert_contains "$OUT" "production" "list: the second target"

# shellcheck disable=SC2016  # the host is written literally: it must reach the tool unexpanded
for bad in "-oProxyCommand=touch /tmp/pwned" "host name" 'host;rm' '$(id)' "-x@host" "a@b@c"; do
    shuttle -y deploy --setup evil --host "$bad" --command 'x {modules}' --branch develop
    assert_status 1 "$RC" "setup refuses the host [$bad]"
done
assert_eq "" "$(git config shuttle.deploy.evil.host)" "...and saves nothing"
shuttle -y deploy --setup evil --host h --port 70000 --command 'x' --branch develop
assert_status 1 "$RC" "setup refuses a port out of range"
shuttle -y deploy --setup evil --host h --command '-rf x' --branch develop
assert_status 1 "$RC" "setup refuses a command that starts with a dash"
shuttle -y deploy --setup evil --host h --command 'x' --branch '--force'
assert_status 1 "$RC" "setup refuses a branch that starts with a dash"
shuttle -y deploy --setup evil --host h --command 'x' --branch develop --sudo yes
assert_status 1 "$RC" "setup refuses sudo=yes (none or ask)"
shuttle -y deploy --setup 'Bad Name' --host h --command 'x' --branch develop
assert_status 1 "$RC" "setup refuses a name with capitals and spaces"
shuttle -y deploy staging --host x
assert_status 1 "$RC" "a setup flag without --setup is refused"

# --- the plan ----------------------------------------------------------------------------------------------------------------------------
shuttle deploy staging --plan
assert_status 0 "$RC" "plan"
assert_contains "$OUT" "custom_technicien,sale_documents" "...finds the modules (and not docs/)"
assert_contains "$OUT" "staging-update custom_technicien,sale_documents" "...shows the exact command"
assert_contains "$OUT" "203.0.113.10" "...and the server"
assert_eq "0" "$(calls)" "...touches no server"
shuttle deploy --plan
assert_status 1 "$RC" "two targets and none named is refused"
assert_contains "$OUT" "production|staging" "...and lists them"
PJ=$(porcelain_json deploy staging --plan --porcelain)
assert_eq "custom_technicien,sale_documents" "$(pj modules)" "porcelain: the modules"
assert_eq "develop" "$(pj branch)" "porcelain: the branch"
assert_eq "staging-update custom_technicien,sale_documents" "$(pj command)" "porcelain: the command"
assert_eq "none" "$(pj sudo)" "porcelain: sudo"
shuttle deploy staging --plan --modules 'a;rm -rf /'
assert_status 1 "$RC" "plan refuses modules with a shell character"
shuttle deploy staging --plan --modules 'sale_order,stock'
assert_contains "$OUT" "staging-update sale_order,stock" "plan: modules given by hand win"

# --- deploying ---------------------------------------------------------------------------------------------------------------------------
reset_log
shuttle -y deploy staging
assert_status 0 "$RC" "deploy"
assert_contains "$OUT" "server ran: staging-update custom_technicien,sale_documents" "...the server ran the command"
assert_eq "2" "$(calls)" "...one check, one run"
assert_contains "$(cat "$SSHLOG")" "[-o] [BatchMode=yes]" "...ssh never asks for its own login"
assert_contains "$(cat "$SSHLOG")" "[-T] [--] [deploy@203.0.113.10] [staging-update custom_technicien,sale_documents]" "...host after --, no terminal"
LAST=$(cat "$(git rev-parse --git-common-dir)/shuttle-deploy/staging.last")
assert_eq "$(git rev-parse origin/develop)" "$LAST" "...remembers the commit it deployed"
shuttle deploy staging --plan
assert_contains "$OUT" "since:      the last deploy from here" "plan after a deploy: since the last one"
shuttle deploy staging --plan --modules sale_documents
assert_status 0 "$RC" "...with modules by hand it still plans"
shuttle deploy staging --plan
assert_status 0 "$RC" "plan with nothing changed since the last deploy"
assert_contains "$OUT" "name them with --modules" "...says the modules must be named"
PJ=$(porcelain_json deploy staging --plan --porcelain)
assert_eq "1" "$(pj needs-modules)" "...porcelain: needs-modules"
reset_log
shuttle -y deploy staging
assert_status 1 "$RC" "a deploy with nothing changed needs the modules"
assert_contains "$OUT" "--modules" "...and says so"
assert_eq "0" "$(calls)" "...nothing ran"
remote_commit develop sale_documents/models.py "x" "change sale_documents"
shuttle deploy staging --plan
assert_contains "$OUT" "modules:    sale_documents" "after a change: only that module"
assert_not_contains "$OUT" "custom_technicien" "...not the one that did not change"

# --- a dry run --------------------------------------------------------------------------------------------------------------------------
reset_log
shuttle -n deploy staging
assert_status 0 "$RC" "dry run"
assert_contains "$OUT" "staging-update sale_documents" "...shows the command"
assert_eq "0" "$(calls)" "...runs nothing"

# --- ssh problems: the deploy never starts -------------------------------------------------------------------------------------
for mode in deny:"can only use a key" hostkey:"is not trusted yet" unreach:"cannot reach" other:"failed"; do
    reset_log
    FAKE_SSH_CHECK=${mode%%:*} shuttle -y deploy staging
    assert_status 1 "$RC" "ssh ${mode%%:*}: refused before anything runs"
    assert_contains "$OUT" "${mode#*:}" "...with a hint"
    assert_eq "0" "$(deploys)" "...and the command was not run"
done

# --- on a terminal: ssh may ask for the login password, once, on a connection that the calls share (like odoo-mirror) --------------
reset_log
with_tty "y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 0 "$RC" "deploy on a terminal"
assert_contains "$(cat "$SSHLOG")" "[ControlMaster=auto]" "...ssh shares one connection, so the password is asked once"
assert_not_contains "$(cat "$SSHLOG")" "BatchMode" "...and it may ask for the login password itself"
assert_contains "$(cat "$SSHLOG")" "[-O] [exit]" "...the shared connection is closed at the end"
reset_log
FAKE_SSH_CHECK=deny with_tty "y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 1 "$RC" "a refused login on a terminal"
assert_contains "$OUT" "wrong password, or not the right user" "...says what to look at"
assert_eq "0" "$(deploys)" "...and nothing ran"
reset_log
git config shuttle.deploy.staging.host 203.0.113.10
FAKE_SSH_CHECK=deny with_tty "|y" "$SHUTTLE" deploy staging --modules sale_documents
assert_contains "$OUT" "the server has no user" "a refused login on a server without a user says so"
assert_contains "$OUT" "user@host" "...and how to write it"
# the user is asked for when the server has none, and kept once the login worked
reset_log
with_tty "odooAdmin|y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 0 "$RC" "a server without a user: the user is asked for on a terminal"
assert_contains "$OUT" "User on 203.0.113.10" "...the question says for which server"
assert_contains "$(cat "$SSHLOG")" "[odooAdmin@203.0.113.10]" "...ssh gets user@host"
assert_eq "odooAdmin@203.0.113.10" "$(git config shuttle.deploy.staging.host)" "...and the user is kept with the server"
git config shuttle.deploy.staging.host 203.0.113.10
reset_log
FAKE_SSH_CHECK=deny with_tty "odooAdmin|y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 1 "$RC" "a refused login with a user that was asked for"
assert_eq "203.0.113.10" "$(git config shuttle.deploy.staging.host)" "...is not kept"
reset_log
with_tty "|y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 0 "$RC" "Enter at the question leaves the user to ssh"
assert_contains "$(cat "$SSHLOG")" "[203.0.113.10]" "...ssh gets the host as it is"
git config shuttle.deploy.staging.host deploy@203.0.113.10
reset_log
shuttle -y deploy staging --modules sale_documents
assert_contains "$(cat "$SSHLOG")" "[BatchMode=yes]" "without a terminal ssh never asks"
assert_not_contains "$(cat "$SSHLOG")" "ControlMaster" "...and shares nothing"

# --- the command fails on the server -------------------------------------------------------------------------------------------
BEFORE=$(cat "$(git rev-parse --git-common-dir)/shuttle-deploy/staging.last")
FAKE_SSH_RC=7 shuttle -y deploy staging --modules sale_documents
assert_status 2 "$RC" "a failing command stops the deploy"
assert_contains "$OUT" "exit 7" "...with its exit code"
assert_contains "$OUT" "half way" "...and a warning"
assert_eq "$BEFORE" "$(cat "$(git rev-parse --git-common-dir)/shuttle-deploy/staging.last")" "...the last good deploy is not moved"
assert_contains "$(cat "$(git rev-parse --git-common-dir)/shuttle-deploy/staging.log")" "failed(7)" "...but the log has it"

# --- the server does not find the command (an alias of the login shell, say) -------------------------------------------------
FAKE_SSH_RC=127 shuttle -y deploy staging --modules sale_documents
assert_status 2 "$RC" "a command that is not found stops the deploy"
assert_contains "$OUT" "did not find the command" "...and says nothing ran"
assert_contains "$OUT" "type -a staging-update" "...with the way to find where it is"
assert_contains "$OUT" "bash -ic" "...and the way around an alias"

# --- commits that are not pushed -------------------------------------------------------------------------------------------------
git checkout -q develop
echo local >> file.txt; git commit -q -am "not pushed"
git checkout -q main
shuttle -y deploy staging
assert_status 1 "$RC" "commits of the branch that are not on the remote"
assert_contains "$OUT" "not on 'origin' yet" "...are refused"
git checkout -q develop; git reset -q --hard origin/develop; git checkout -q main

# --- production asks for its name --------------------------------------------------------------------------------------------------
git checkout -q release; git reset -q --hard origin/release
remote_commit release sale_documents/__manifest__.py "{}" "release sale_documents"
git checkout -q main
reset_log
shuttle -y deploy production
assert_status 1 "$RC" "--yes alone does not deploy to a target that asks for its name"
assert_contains "$OUT" "--confirm production" "...and says what to add"
assert_eq "0" "$(calls)" "...nothing ran"
shuttle -y deploy production --confirm staging
assert_status 3 "$RC" "the wrong name declines"
assert_eq "0" "$(calls)" "...nothing ran"
with_tty "production" "$SHUTTLE" deploy production
assert_status 0 "$RC" "the name typed at the terminal deploys"
assert_contains "$OUT" "server ran: production-update sale_documents" "...the production command ran"
with_tty "nope" "$SHUTTLE" deploy production --modules sale_documents
assert_status 3 "$RC" "a name typed wrong declines"
shuttle -y deploy production --confirm production --modules sale_documents
assert_status 0 "$RC" "--confirm with the right name deploys"

# --- a sudo password: the terminal of sudo itself ----------------------------------------------------------------------------
shuttle -y deploy --setup staging --sudo ask
assert_eq "ask" "$(git config shuttle.deploy.staging.sudo)" "setup: sudo=ask is saved"
assert_eq "deploy@203.0.113.10" "$(git config shuttle.deploy.staging.host)" "...and what was saved is kept"
reset_log
shuttle -y deploy staging --modules sale_documents
assert_status 1 "$RC" "sudo=ask without a terminal is refused"
assert_contains "$OUT" "terminal" "...says why"
assert_eq "0" "$(calls)" "...nothing ran"
with_tty "y" "$SHUTTLE" deploy staging --modules sale_documents
assert_status 0 "$RC" "sudo=ask on a terminal"
assert_contains "$(cat "$SSHLOG")" "[-t] [--]" "...ssh gets a terminal, so sudo asks there"
assert_not_contains "$(cat "$SSHLOG")" "password" "...and no password goes through git-shuttle"

# --- check, forget ------------------------------------------------------------------------------------------------------------------
reset_log
shuttle deploy staging --check
assert_status 0 "$RC" "check"
assert_eq "1" "$(calls)" "...one call, the command true"
assert_eq "0" "$(deploys)" "...and nothing is deployed"
shuttle -y deploy --forget staging
assert_status 0 "$RC" "forget"
assert_eq "" "$(git config shuttle.deploy.staging.host)" "...the settings are gone"
shuttle deploy staging --plan
assert_status 1 "$RC" "a forgotten target is refused"
shuttle deploy --forget nothing
assert_status 1 "$RC" "forget of an unknown target is refused"

# --- a branch that is not on the remote ---------------------------------------------------------------------------------------------
shuttle -y deploy --setup ghost --host h --command 'x' --branch nowhere
shuttle deploy ghost --plan
assert_status 1 "$RC" "a branch that is not on the remote"
assert_contains "$OUT" "push it first" "...says to push it"

# --- not a repository ---------------------------------------------------------------------------------------------------------------------
( cd "$SB" && "$SHUTTLE" deploy --list >"$SB/o" 2>&1 ); RC=$?
assert_status 1 "$RC" "outside a repository"

finish
