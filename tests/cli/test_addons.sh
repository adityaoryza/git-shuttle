#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# Add-ons (docs/addons.md), against a stand-in add-on: a program named git-shuttle-task that answers by FAKE_MODE.
sandbox_new
fake_gh
AD="$SB/addons"; mkdir -p "$AD"
export GIT_SHUTTLE_ADDON_HOME="$SB/addon-home"     # (add-ons that were installed on this machine are not part of a test)
export GIT_SHUTTLE_ADDON_PATH="$AD" FAKE_LOG="$SB/addon.log" SECRET_TOKEN="do-not-leak-me"
PROG="$AD/git-shuttle-task"
cat >"$SB/prog.tpl" <<'EOF'
#!/usr/bin/env bash
# the stand-in of an add-on: it records what it was given, and answers as FAKE_MODE says
log=${FAKE_LOG:-/dev/null}
mode=${FAKE_MODE:-__BAKED__}     # a manifest is read before the add-on is enabled, when it receives no variable: the mode is baked in then
case "${1:-}" in
    --shuttle-manifest)
        case "$mode" in
            badjson) echo "this is not json" ;;
            wrongname) echo '{"protocol":1,"name":"other","hooks":[]}' ;;
            protocol2) echo '{"protocol":2,"name":"task","hooks":[]}' ;;
            reserved) echo '{"protocol":1,"name":"task","hooks":["start"],"flags":{"start":["--from"]}}' ;;
            badenv) echo '{"protocol":1,"name":"task","hooks":[],"env":["lower"]}' ;;
            *) echo '{"protocol":1,"name":"task","version":"1.2.3","description":"Tasks of a tracker","hooks":["start","pr","status"],"flags":{"start":["--task"]},"env":["FAKE_MODE","FAKE_LOG"]}' ;;
        esac ;;
    hook)
        cat >"$log.input"
        env >"$log.env"
        [[ -t 0 ]] && echo stdin-tty >"$log.tty" || echo stdin-none >"$log.tty"
        case "$2:$mode" in
            start:ok) echo '{"branch":"Keep manual Order Date","reference":{"id":"15607","title":"Keep manual Order Date on confirmation","link":"https://odoo.example/web#id=15607"},"note":"task found"}' ;;
            start:quotes) echo '{"branch":"Copy \"Export to Cigolog\" to Accounting ($5?)","reference":{"id":"1"}}' ;;
            start:evil) echo '{"branch":"../../etc passwd; rm -rf x","reference":{"id":"1"}}' ;;
            start:badlink) echo '{"branch":"x","reference":{"id":"1","link":"javascript:alert(1)"}}' ;;
            start:badid) echo '{"branch":"x","reference":{"id":"1; rm -rf /"}}' ;;
            start:nobranch) echo '{"reference":{"id":"7","title":"Only a reference"}}' ;;
            start:slow|pr:slow|status:slow) sleep 6 ;;
            start:big) head -c 400000 /dev/zero | tr '\0' 'a' ;;
            start:fail) echo "boom" >&2; exit 3 ;;
            start:decline) echo "no such task" >&2; exit 1 ;;
            start:crash) printf 'Traceback (most recent call last):\n  boom\n' >&2; exit 1 ;;
            pr:ok) printf '%s\n' '{"title":"Keep manual Order Date","body":"Task: https://odoo.example/web#id=15607\n\nSecond line"}' ;;
            status:ok) echo '{"cards":[{"title":"Keep manual Order Date","subtitle":"Running","link":"https://odoo.example/web#id=15607","text":"Order date stays.","fields":[{"label":"Project","value":"Confort et eau"}]}]}' ;;
            status:evil) printf '%s\n' '{"cards":[{"title":"T\u001b[31mred","link":"javascript:x","fields":[]}]}' ;;
            *) echo '{}' ;;
        esac ;;
    hello) shift; echo "hello from the add-on: $*" ;;
esac
EOF
bake() { sed "s/__BAKED__/$1/" "$SB/prog.tpl" >"$PROG"; chmod +x "$PROG"; }
bake ok

# --- finding them ------------------------------------------------------------------------------------------------------------------------
GIT_SHUTTLE_ADDON_PATH="$SB/none" PATH="/usr/bin:/bin" shuttle addon list
assert_status 0 "$RC" "list with no add-on"
assert_contains "$OUT" "No add-on found" "...says so"
shuttle addon list
assert_status 0 "$RC" "list"
assert_contains "$OUT" "task" "...shows the add-on that was found"
assert_contains "$OUT" "found" "...as found, not enabled"
shuttle addon list --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT" | tr '\037' '|')" "addon=task|found|" "porcelain: name and state"

# --- what it asks for, and nothing runs until it is enabled --------------------------------------------------------------------------
shuttle addon info task
assert_status 0 "$RC" "info (it runs the program to read its manifest)"
assert_contains "$OUT" "hooks:       start pr status" "...says the hooks"
assert_contains "$OUT" "adds flags:  start:--task" "...the flags it adds"
assert_contains "$OUT" "FAKE_MODE FAKE_LOG" "...and the only variables it may read"
shuttle -y start --task 15607
assert_status 1 "$RC" "a flag of an add-on that is not enabled"
assert_contains "$OUT" "unknown option '--task'" "...is not known"
shuttle task hello
assert_status 1 "$RC" "the command of an add-on that is not enabled"
assert_contains "$OUT" "git shuttle addon enable task" "...says how"

for mode in badjson:"is not JSON" wrongname:"its name is" protocol2:"speaks protocol" reserved:"flag of git-shuttle itself" badenv:"env must be a list"; do
    bake "${mode%%:*}"
    shuttle -y addon enable task
    assert_status 1 "$RC" "enable with a manifest that is ${mode%%:*}"
    assert_contains "$OUT" "${mode#*:}" "...says why"
done
bake ok
assert_eq "" "$(git config shuttle.addon.task.enabled)" "...and nothing was saved"
shuttle -y addon enable status
assert_status 1 "$RC" "an add-on cannot be called like a command of git-shuttle"
shuttle -n addon enable task
assert_eq "" "$(git config shuttle.addon.task.enabled)" "enable --dry-run saves nothing"

# --- enabling pins it ---------------------------------------------------------------------------------------------------------------------------
shuttle -y addon enable task
assert_status 0 "$RC" "enable"
assert_contains "$OUT" "pinned to:" "...says that it is pinned"
assert_eq "true" "$(git config shuttle.addon.task.enabled)" "...saved as enabled"
assert_eq "start pr status" "$(git config --get-all shuttle.addon.task.hooks | paste -sd' ' -)" "...with its hooks"
assert_eq "start:--task" "$(git config --get-all shuttle.addon.task.flags)" "...and its flags"
assert_eq "64" "$(git config shuttle.addon.task.sha256 | tr -d '\n' | wc -c | tr -d ' ')" "...and the checksum of the program"
shuttle addon list
assert_contains "$OUT" "enabled" "list: enabled"

# a title with quotes and other signs: they are dropped from the name, the answer is not refused
FAKE_MODE=quotes shuttle -n start --task 1
assert_status 0 "$RC" "a task title with quotes is not refused"
assert_contains "$OUT" "feature/copy_export_to_cigolog_to_accounting_5" "...and gives a clean branch name"

# --- start --task -------------------------------------------------------------------------------------------------------------------------------
git checkout -q develop
FAKE_MODE=ok shuttle -y start --task 15607
assert_status 0 "$RC" "start --task"
assert_eq "feature/keep_manual_order_date" "$(git symbolic-ref --short HEAD)" "...the branch is made from the title: no [Sales], no number"
assert_contains "$OUT" "for:        task #15607" "...says what it is for"
assert_contains "$OUT" "task found" "...and shows the note of the add-on"
assert_eq "task" "$(git config branch.feature/keep_manual_order_date.shuttle-ref-addon)" "...the branch remembers the add-on"
assert_eq "15607" "$(git config branch.feature/keep_manual_order_date.shuttle-ref-id)" "...the task number"
assert_eq "Keep manual Order Date on confirmation" "$(git config branch.feature/keep_manual_order_date.shuttle-ref-title)" "...its title"
assert_eq "https://odoo.example/web#id=15607" "$(git config branch.feature/keep_manual_order_date.shuttle-ref-link)" "...and its link"
INPUT=$(cat "$FAKE_LOG.input")
assert_contains "$INPUT" '"protocol": 1' "the add-on received the protocol version"
assert_contains "$INPUT" '"task": "15607"' "...the value of its flag"
assert_contains "$INPUT" '"name": "' "...the name of the repository"
assert_not_contains "$(cat "$FAKE_LOG.env")" "do-not-leak-me" "the add-on did not receive the other variables of the environment"
assert_contains "$(cat "$FAKE_LOG.env")" "FAKE_MODE=ok" "...only the ones it declared"
assert_eq "stdin-none" "$(cat "$FAKE_LOG.tty")" "...and no terminal"

# --- the trace: what happened to the task ---------------------------------------------------------------------------------------------
TRACE="$(git rev-parse --path-format=absolute --git-common-dir)/shuttle-trace/events.jsonl"
assert_contains "$(cat "$TRACE")" '"type": "start"' "the start of the task was traced"
assert_contains "$(cat "$TRACE")" '"task": "15607"' "...with the task"
assert_eq "600" "$(stat -c %a "$TRACE")" "...in a file that only you can read"
echo "more" >trace-more.txt
git add trace-more.txt
shuttle -y commit -m "[FEAT] root: more" -- trace-more.txt
assert_contains "$(cat "$TRACE")" '"type": "commit"' "a commit on the branch was traced"
before=$(wc -l <"$TRACE")
shuttle -n push
assert_eq "$before" "$(wc -l <"$TRACE")" "a dry run traces nothing"
shuttle trace list
assert_contains "$OUT" "15607" "trace list shows the task"
shuttle trace list --porcelain
assert_contains "$OUT" '"id": "15607"' "...and gives it as JSON with --porcelain"
shuttle trace show 15607 --addon task
assert_status 0 "$RC" "trace show"
assert_contains "$OUT" "commit" "...lists the steps"
git checkout -q -b plain-branch develop
echo plain >plain.txt; git add plain.txt
before=$(wc -l <"$TRACE")
shuttle -y commit -m "[FEAT] root: plain" -- plain.txt
assert_eq "$before" "$(wc -l <"$TRACE")" "a branch that is not for a task traces nothing"
# a branch that already has work is linked to a task afterwards: its past is written with the dates it had
echo old >old.txt; git add old.txt
GIT_AUTHOR_DATE="2026-01-05T10:00:00+02:00" GIT_COMMITTER_DATE="2026-01-05T10:00:00+02:00" git commit -q -m "an old commit"
FAKE_MODE=ok shuttle -n trace bind 15607
assert_status 0 "$RC" "trace bind --dry-run"
assert_contains "$OUT" "2 commit(s)" "...says how many commits the branch has"
assert_eq "" "$(git config branch.plain-branch.shuttle-ref-id)" "...and links nothing"
assert_eq "$before" "$(wc -l <"$TRACE")" "...and writes nothing"
FAKE_MODE=ok shuttle -y trace bind 15607
assert_status 0 "$RC" "trace bind"
assert_eq "15607" "$(git config branch.plain-branch.shuttle-ref-id)" "...the branch remembers the task"
assert_contains "$(cat "$TRACE")" '"time": "2026-01-05T08:00:00Z"' "...the old commit is in the trace with its own date (in UTC)"
assert_contains "$(cat "$TRACE")" '"subject": "an old commit"' "...with its subject"
assert_contains "$(cat "$TRACE")" '"type": "bind"' "...and the link itself is a step"
after=$(wc -l <"$TRACE")
FAKE_MODE=ok shuttle -y trace bind 15607
assert_eq "$after" "$(wc -l <"$TRACE")" "linking again adds nothing that is already there"
shuttle trace show 15607 --addon task
assert_contains "$OUT" "an old commit" "trace show lists what was added afterwards"
shuttle trace map
assert_status 0 "$RC" "trace map (for the graph of the web UI)"
assert_contains "$OUT" '"plain-branch"' "...has the branches that are for a task"
assert_contains "$OUT" "$(git rev-parse HEAD)" "...and the commits of those branches, also the ones that were not made by git-shuttle"
assert_not_contains "$OUT" "\"$(git rev-parse develop)\"" "...but not the commits of the integration branch"
shuttle -n trace unbind --branch plain-branch
assert_status 0 "$RC" "trace unbind --dry-run"
assert_eq "15607" "$(git config branch.plain-branch.shuttle-ref-id)" "...changes nothing"
shuttle -y trace unbind --branch plain-branch
assert_status 0 "$RC" "trace unbind"
assert_eq "" "$(git config branch.plain-branch.shuttle-ref-id)" "...the branch forgets the task"
assert_not_contains "$(cat "$TRACE")" '"branch": "plain-branch"' "...and its steps leave the trace"
assert_contains "$(cat "$TRACE")" '"branch": "feature/keep_manual_order_date"' "...but not the steps of the other branches"
shuttle -y trace unbind --branch plain-branch
assert_status 1 "$RC" "unlinking a branch that is not linked"
git checkout -q develop
FAKE_MODE=ok shuttle -y trace bind 15607
assert_status 1 "$RC" "a shared branch cannot be linked to a task"
assert_contains "$OUT" "shared branch" "...and says why"
git checkout -q main
FAKE_MODE=ok shuttle -y trace bind 15607
assert_status 1 "$RC" "the base branch cannot be linked either"
git checkout -q develop
git checkout -q feature/keep_manual_order_date

git checkout -q develop
git branch -q -D feature/keep_manual_order_date
git config --remove-section branch.feature/keep_manual_order_date 2>/dev/null || true
shuttle -n start --task 15607
assert_status 0 "$RC" "start --task --dry-run"
assert_contains "$OUT" "feature/keep_manual_order_date" "...shows the branch"
git show-ref -q --verify refs/heads/feature/keep_manual_order_date && made=yes || made=no
assert_eq "no" "$made" "...and makes nothing"
assert_eq "" "$(git config branch.feature/keep_manual_order_date.shuttle-ref-id)" "...nor the settings of the branch"

FAKE_MODE=ok shuttle -y start "my own name" --task 15608
assert_eq "feature/my_own_name" "$(git symbolic-ref --short HEAD)" "a name that is given wins over the one of the add-on"
assert_eq "15607" "$(git config branch.feature/my_own_name.shuttle-ref-id)" "...and the task is still the one of the add-on"
git checkout -q develop

FAKE_MODE=nobranch shuttle -y start --task 7
assert_status 1 "$RC" "an add-on that gives no branch name, and none was given"
assert_contains "$OUT" "gave no branch name" "...says so"
FAKE_MODE=nobranch shuttle -y start "named by me" --task 7
assert_status 0 "$RC" "...with a name given it works"
assert_eq "7" "$(git config branch.feature/named_by_me.shuttle-ref-id)" "...and records the task"
git checkout -q develop

# --- what the add-on says is checked ------------------------------------------------------------------------------------------------------
for mode in evil:"branch has characters" badlink:"http or https" badid:"reference.id has characters" fail:"boom" big:"longer than" slow:"did not answer"; do
    GIT_SHUTTLE_ADDON_TIMEOUT=1 FAKE_MODE=${mode%%:*} shuttle -y start --task 1
    assert_status 1 "$RC" "start --task with an add-on that answers [${mode%%:*}]"
    assert_contains "$OUT" "${mode#*:}" "...says why"
done
assert_eq "develop" "$(git symbolic-ref --short HEAD)" "none of them moved the branch"
assert_eq "0" "$(git for-each-ref refs/heads/feature | grep -c 'etc\|passwd\|rm_rf')" "...or made a strange branch"

# --- pass-through -------------------------------------------------------------------------------------------------------------------------------
shuttle task hello world
assert_status 0 "$RC" "the command of an enabled add-on"
assert_eq "hello from the add-on: world" "$OUT" "...runs the program with the arguments"

# --- a program that changed has to be enabled again ----------------------------------------------------------------------------------------
echo "# changed" >>"$PROG"
shuttle addon list
assert_contains "$OUT" "changed" "list: the program is not the one that was enabled"
shuttle task hello
assert_status 1 "$RC" "its command"
assert_contains "$OUT" "it changed" "...is refused, and says why"
shuttle -y start --task 1
assert_status 1 "$RC" "its flag"
assert_contains "$OUT" "unknown option '--task'" "...is unknown again"
shuttle -y addon enable task
assert_status 0 "$RC" "enabling it again"
shuttle task hello again
assert_eq "hello from the add-on: again" "$OUT" "...makes it work"

# --- the pull request ----------------------------------------------------------------------------------------------------------------------------
git checkout -q feature/my_own_name
echo more > pr-file.txt; git add pr-file.txt; git commit -q -m "[FEAT] shop: a thing"
git push -q -u origin feature/my_own_name
: >"$SB/gh.log"
shuttle -y pr
assert_status 0 "$RC" "pr on a branch that is for a task"
assert_contains "$OUT" "title:        Keep manual Order Date" "...the title is the one of the add-on"
assert_contains "$OUT" "from the add-on 'task'" "...says where the description comes from"
assert_contains "$(cat "$SB/gh.log")" "Task: https://odoo.example/web#id=15607" "...gh gets the description of the add-on"
assert_contains "$(cat "$FAKE_LOG.input")" '[FEAT] shop: a thing"' "...which received the commits, oldest first: a short hash, then the subject"
assert_contains "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commits"])' "$FAKE_LOG.input")" " [FEAT] shop: a thing" "...(the hash and the subject are separated by a space)"
: >"$SB/gh.log"
shuttle -y pr --title "My own title"
assert_contains "$(cat "$SB/gh.log")" "My own title" "a title that is typed wins"
assert_contains "$(cat "$SB/gh.log")" "Task: https://odoo.example/web#id=15607" "...the description still comes from the add-on"
: >"$SB/gh.log"
shuttle -y pr --title "T" --body "my body"
assert_contains "$(cat "$SB/gh.log")" "my body" "a description that is typed wins"
assert_not_contains "$(cat "$SB/gh.log")" "Task: https" "...over the one of the add-on"
: >"$SB/gh.log"
GIT_SHUTTLE_ADDON_TIMEOUT=1 FAKE_MODE=slow shuttle -y pr
assert_status 0 "$RC" "an add-on that does not answer does not stop a pull request"
assert_contains "$OUT" "gave no pull request text" "...it is said"
assert_contains "$(cat "$SB/gh.log")" "[FEAT] shop: a thing" "...and the title is the last commit, as without it"
git checkout -q develop

# --- the cards of the page ----------------------------------------------------------------------------------------------------------------
git checkout -q feature/my_own_name
shuttle addon cards
assert_status 0 "$RC" "cards"
assert_contains "$OUT" "== Keep manual Order Date  (Running)" "...the title and subtitle"
assert_contains "$OUT" "Project: Confort et eau" "...and the fields"
shuttle addon cards --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT")" '"title":"Keep manual Order Date"' "porcelain: JSON, checked"
FAKE_MODE=evil shuttle addon cards --porcelain
assert_not_contains "$(tr '\0' '\n' <<<"$OUT")" "javascript:" "a link that is not http or https is refused"
git checkout -q develop

# --- checking an add-on (for its author) ----------------------------------------------------------------------------------------------------
shuttle addon check task
assert_status 0 "$RC" "check of a good add-on"
assert_contains "$OUT" "ok    the manifest is valid" "...the manifest"
assert_contains "$OUT" "ok    hook 'start' answered" "...each hook"
FAKE_MODE=evil shuttle addon check task
assert_status 1 "$RC" "check of an add-on that says what it must not"
assert_contains "$OUT" "FAIL  hook 'start'" "...names the hook"
FAKE_MODE=decline shuttle addon check task
assert_status 0 "$RC" "check of an add-on that declines with a message (an unknown task is an answer)"
assert_contains "$OUT" "declined, saying why: no such task" "...says so"
FAKE_MODE=crash shuttle addon check task
assert_status 1 "$RC" "check of an add-on that crashes (a traceback)"
FAKE_MODE=fail shuttle addon check task
assert_status 1 "$RC" "check of an add-on that fails with another status than 1"
shuttle addon check nothing
assert_status 1 "$RC" "check of a program that does not exist"

# --- disabling ------------------------------------------------------------------------------------------------------------------------------
shuttle -y addon disable task
assert_status 0 "$RC" "disable"
assert_eq "" "$(git config shuttle.addon.task.enabled)" "...nothing of it is left in the settings"
shuttle -y start --task 1
assert_contains "$OUT" "unknown option '--task'" "...its flags are unknown again"
shuttle -y addon disable task
assert_status 1 "$RC" "disabling what is not enabled"
shuttle addon bogus
assert_status 1 "$RC" "an unknown subcommand"

# --- a name that cannot be an add-on is never run ------------------------------------------------------------------------------------------
printf '#!/bin/sh\necho "I ran"\n' >"$AD/git-shuttle-status"; chmod +x "$AD/git-shuttle-status"
shuttle addon list
assert_not_contains "$OUT" "status " "a program called like a command of git-shuttle is not listed"
printf '#!/bin/sh\necho "I ran"\n' >"$AD/git-shuttle-Bad_Name"; chmod +x "$AD/git-shuttle-Bad_Name"
shuttle addon list
assert_not_contains "$OUT" "Bad_Name" "...nor one with a name that is not valid"

# --- what could go wrong ------------------------------------------------------------------------------------------------------------------
# a folder of the PATH that is not absolute is never searched: a repository could carry a program that way
mkdir -p "$SB/rel"; printf '#!/bin/sh\necho "I ran from here"\n' >"$SB/rel/git-shuttle-here"; chmod +x "$SB/rel/git-shuttle-here"
( cd "$SB/rel" && GIT_SHUTTLE_ADDON_PATH="" PATH=".:$PATH" "$SHUTTLE" addon list >"$SB/o" 2>&1 )
assert_eq "0" "$(grep -c '^here ' "$SB/o")" "a relative folder of the PATH is not searched"
( cd "$SB/rel" && GIT_SHUTTLE_ADDON_PATH="" PATH=":$PATH" "$SHUTTLE" here >"$SB/o" 2>&1 ); RC=$?
assert_status 1 "$RC" "...and an empty entry of the PATH (it means here) neither"
shuttle "../evil" x
assert_status 1 "$RC" "a command with a slash is not run as an add-on"
shuttle "a b" x
assert_status 1 "$RC" "...nor one with a space"
# a program that says something that is not text
cat >"$AD/git-shuttle-junk" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in --shuttle-manifest) printf '\377\376 not utf-8 \000 at all' ;; esac
EOF
chmod +x "$AD/git-shuttle-junk"
shuttle -y addon enable junk
assert_status 1 "$RC" "an add-on whose answer is not text"
assert_contains "$OUT" "not JSON" "...is refused"
# a link to a program is followed: it has to answer with its own name
mkdir -p "$SB/linked"; ln -sf "$AD/git-shuttle-task" "$SB/linked/git-shuttle-via"
GIT_SHUTTLE_ADDON_PATH="$SB/linked" shuttle addon info via
assert_status 1 "$RC" "an add-on called by a link that answers with another name"
assert_contains "$OUT" "its name is 'task'" "...is refused"

# --- setup: what an add-on needs from you (a login, a key) ---------------------------------------------------------------------------
cat >"$AD/git-shuttle-keyed" <<'EOF'
#!/usr/bin/env bash
state="${FAKE_LOG}.keyed"
case "${1:-}" in
    --shuttle-manifest) echo '{"protocol":1,"name":"keyed","hooks":["setup"],"env":["FAKE_LOG"]}' ;;
    hook)
        input=$(cat)
        echo "$@" >>"$state.argv"
        if grep -q '"action": "save"' <<<"$input"; then
            key=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["values"].get("api_key", ""))' <<<"$input")
            [[ "$key" == "wrong-key-000" ]] && { echo '{"ok":false,"message":"refused wrong-key-000 and nothing else"}'; exit 0; }
            printf '%s' "$key" >"$state"
            echo "{\"ok\":true,\"message\":\"connected with $key\"}"
        else
            set=false; [[ -s "$state" ]] && set=true
            echo "{\"ready\":$set,\"note\":\"Profile keyed\",\"fields\":[{\"key\":\"login\",\"kind\":\"text\",\"label\":\"Login\",\"value\":\"me\",\"required\":true},{\"key\":\"api_key\",\"kind\":\"secret\",\"label\":\"API key\",\"value\":\"must-not-show\",\"set\":$set,\"required\":true}]}"
        fi ;;
esac
EOF
chmod +x "$AD/git-shuttle-keyed"
shuttle addon setup keyed
assert_status 1 "$RC" "setup of an add-on that is not enabled"
assert_contains "$OUT" "not enabled for 'setup'" "...is refused"
shuttle -y addon enable keyed
assert_status 0 "$RC" "enable an add-on that has a setup"
shuttle addon setup keyed
assert_status 0 "$RC" "setup shows the fields"
assert_contains "$OUT" "not ready yet" "...and that it is not ready"
assert_not_contains "$OUT" "must-not-show" "...a secret never shows a value, even when the add-on gives one"
assert_contains "$OUT" "(not set)" "...only whether it is set"
shuttle addon setup keyed --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT")" '"kind":"secret"' "porcelain: the fields as JSON"
assert_not_contains "$OUT" "must-not-show" "...with no value for a secret"
shuttle addon list --porcelain
assert_contains "$(tr '\0' '\n' <<<"$OUT" | tr '\037' '|')" "addon=keyed|enabled|" "list porcelain: the hooks of an enabled add-on are in the last field"
rest=$(tr '\037' '|' <<<"${OUT#*addon=keyed}")
assert_contains "${rest%%addon=*}" "|setup" "...so the UI knows it has a setup"
OUT=$(echo '{"api_key":"good-key-123"}' | "$SHUTTLE" addon setup keyed --save 2>&1); RC=$?
assert_status 0 "$RC" "save a key (given on standard input)"
assert_contains "$OUT" "saved:" "...says so"
assert_not_contains "$OUT" "good-key-123" "...and the key is hidden if the add-on says it back"
assert_not_contains "$(cat "$FAKE_LOG.keyed.argv")" "good-key-123" "the key was not on the command line of the add-on"
assert_eq "good-key-123" "$(cat "$FAKE_LOG.keyed")" "...but the add-on received it"
shuttle addon setup keyed
assert_contains "$OUT" "ready" "after saving it is ready"
assert_contains "$OUT" "(set)" "...and the key shows as set"
OUT=$(echo '{"api_key":"wrong-key-000"}' | "$SHUTTLE" addon setup keyed --save 2>&1); RC=$?
assert_status 1 "$RC" "a key that the add-on refuses"
assert_contains "$OUT" "not saved:" "...says so"
assert_not_contains "$OUT" "wrong-key-000" "...and the key is hidden in the message"
OUT=$(echo '{"api_key":"x"' | "$SHUTTLE" addon setup keyed --save 2>&1); RC=$?
assert_status 1 "$RC" "values that are not JSON are refused"
OUT=$(echo '{"../x":"y"}' | "$SHUTTLE" addon setup keyed --save 2>&1); RC=$?
assert_status 1 "$RC" "a key with characters that are not allowed is refused"

# --- the report: the pull request and the commits, added to the Customer report of the task (off until it is turned on) ------------------
cat >"$AD/git-shuttle-reporter" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
    --shuttle-manifest) echo '{"protocol":1,"name":"reporter","hooks":["report"],"env":["FAKE_LOG","FAKE_MODE"]}' ;;
    hook)
        input=$(cat)
        action=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["action"])' <<<"$input")
        echo "$action" >>"$FAKE_LOG.reporter"
        [[ "$action" == post ]] && printf '%s' "$input" >"$FAKE_LOG.reporter.post"
        case "$action:${FAKE_MODE:-ok}" in
            preview:ok) echo '{"ok":true,"message":"x_customer_report (html) has text: the entry is added after it, the text is kept","text":"git-shuttle - branch rpt\nPull request: T (https://github.example/a/b/pull/7)","field":"x_customer_report"}' ;;
            post:ok) echo '{"ok":true,"message":"Added to x_customer_report of task 77","text":"","field":"x_customer_report"}' ;;
            *:skipped) echo '{"ok":true,"message":"already there","text":"","field":"x_customer_report","skipped":true}' ;;
            *:refused) echo '{"ok":false,"message":"Authentication failed","text":"","field":""}' ;;
            *) echo "boom" >&2; exit 3 ;;
        esac ;;
esac
EOF
chmod +x "$AD/git-shuttle-reporter"
cat >"$SB/gh-report" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$(dirname "$0")/gh-report.log"
case "$1 $2" in
    "pr view") echo '{"url":"https://github.example/a/b/pull/7","number":7,"title":"T","baseRefName":"develop"}' ;;
    *) echo "https://github.example/a/b/pull/7" ;;
esac
EOF
chmod +x "$SB/gh-report"
export GIT_SHUTTLE_GH="$SB/gh-report"
shuttle addon report reporter on
assert_status 1 "$RC" "the report of an add-on that is not enabled"
shuttle -y addon enable reporter
shuttle addon report reporter maybe
assert_status 1 "$RC" "the report must be turned on or off, nothing else"
shuttle -n addon report reporter on
assert_eq "" "$(git config shuttle.addon.reporter.report)" "turning the report on in a dry run changes nothing"
shuttle addon list --porcelain
rest=$(tr '\037' '|' <<<"${OUT#*addon=reporter}")
assert_not_contains "${rest%%addon=*}" "|on" "the report is off at first"

git checkout -q -b rpt develop
echo r >r.txt; git add r.txt; git commit -q -m "[FEAT] shop: a report test"
git config branch.rpt.shuttle-ref-addon reporter
git config branch.rpt.shuttle-ref-id 77
shuttle -y pr
assert_status 0 "$RC" "a pull request of a task whose report is off"
assert_not_contains "$OUT" "Customer report" "...says nothing of the report"
[[ -e "$FAKE_LOG.reporter" ]] && called=yes || called=no
assert_eq "no" "$called" "...and never calls the add-on"

shuttle -y addon report reporter on
assert_status 0 "$RC" "turning the report on"
assert_eq "on" "$(git config shuttle.addon.reporter.report)" "...for this repository only"
rm -f "$FAKE_LOG.reporter" "$FAKE_LOG.reporter.post"
FAKE_MODE=ok shuttle -n pr
assert_status 0 "$RC" "pr --dry-run with the report on"
assert_contains "$OUT" "the entry is added after it, the text is kept" "...shows what it asks of the add-on"
assert_not_contains "$(cat "$FAKE_LOG.reporter")" "post" "...and writes nothing"
FAKE_MODE=ok shuttle -y pr
assert_status 0 "$RC" "pr with the report on"
assert_contains "$OUT" "Customer report of task #77: Added to x_customer_report of task 77" "the report is written after the pull request is open"
POST=$(cat "$FAKE_LOG.reporter.post")
assert_contains "$POST" '"url": "https://github.example/a/b/pull/7"' "...with the address of the pull request"
assert_contains "$POST" '"subject": "[FEAT] shop: a report test"' "...and the commits of the branch"
assert_contains "$POST" '"ref_id": "77"' "...for the task of the branch"
assert_not_contains "$POST" "$SECRET_TOKEN" "...and nothing of the environment"
rm -f "$FAKE_LOG.reporter" "$FAKE_LOG.reporter.post"
FAKE_MODE=refused shuttle -y pr
assert_status 0 "$RC" "a report that the add-on cannot write does not undo the pull request"
assert_contains "$OUT" "Authentication failed" "...and says why"
FAKE_MODE=crash shuttle -y pr
assert_status 0 "$RC" "an add-on that crashes does not either"
assert_contains "$OUT" "Customer report" "...and says it"
FAKE_MODE=skipped shuttle -y trace report
assert_status 0 "$RC" "trace report when the pull request is already in the report"
assert_not_contains "$(cat "$FAKE_LOG.reporter")" "post" "...writes nothing"
rm -f "$FAKE_LOG.reporter" "$FAKE_LOG.reporter.post"
FAKE_MODE=ok shuttle -y trace report
assert_status 0 "$RC" "trace report"
assert_contains "$(cat "$FAKE_LOG.reporter")" "post" "...writes it again, on demand"
git checkout -q develop
shuttle -y trace report --branch develop
assert_status 1 "$RC" "trace report for a branch that is not for a task"
shuttle -y addon report reporter off
assert_eq "off" "$(git config shuttle.addon.reporter.report)" "the report can be turned off again"

finish
