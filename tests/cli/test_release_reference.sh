#!/usr/bin/env bash
# shellcheck source=../helpers/assert.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/assert.sh"
# shellcheck source=../helpers/sandbox.sh
source "$(dirname "${BASH_SOURCE[0]}")/../helpers/sandbox.sh"

# A release branch is cut from the release branch: it is compared with it, and updated from it. Staging (the integration branch) never comes in.
sandbox_new
git config shuttle.releasePattern 'rel/{date}-v1.{n}'
git fetch -q origin
git checkout -q -b rel/20260101-v1.0 origin/release
echo r >r.txt; git add r.txt; git commit -q -m "a release commit"
git push -q -u origin rel/20260101-v1.0
feature feat-one                 # a task branch: from develop

git checkout -q rel/20260101-v1.0
PJ=$(porcelain_json status --porcelain)
assert_eq "origin/release" "$(pj integration.ref)" "a release branch is compared with the release branch"
assert_eq "0" "$(pj integration.behind)" "...so it is not behind staging"
assert_eq "0" "$(pj merged)" "...and is not merged yet"

git checkout -q feat-one
PJ=$(porcelain_json status --porcelain)
assert_eq "origin/develop" "$(pj integration.ref)" "a task branch is compared with the integration branch, as before"

# someone adds a commit to the release branch: the release branch is the one to update from
git checkout -q rel/20260101-v1.0
remote_commit release news.txt "n" "news on the release branch"
git fetch -q origin
PJ=$(porcelain_json status --porcelain)
assert_eq "1" "$(pj integration.behind)" "a new commit of the release branch is the one that makes it behind"
shuttle -n sync
assert_status 0 "$RC" "sync --dry-run on a release branch"
assert_contains "$OUT" "origin/release" "...rebases on the release branch"
assert_not_contains "$OUT" "origin/develop" "...and never on the integration branch"
shuttle -y sync
assert_status 0 "$RC" "sync on a release branch"
assert_contains "$(git log --format=%s -3)" "news on the release branch" "...brings in the commit of the release branch"
assert_not_contains "$(git log --format=%s)" "develop start" "...and nothing of the integration branch"

# a release branch that is in the release branch already: nothing to update
git checkout -q -b rel/20260102-v1.0 origin/release
git push -q -u origin rel/20260102-v1.0
PJ=$(porcelain_json status --porcelain)
assert_eq "1" "$(pj merged)" "a release branch that the release branch contains is merged"

# a release branch goes to the release branch with a pull request: never into staging
git checkout -q rel/20260101-v1.0
fake_gh
shuttle -y ship
assert_status 1 "$RC" "ship of a release branch is refused (it would rebase it on staging and merge it there)"
assert_contains "$OUT" "is a release branch" "...and says why"
assert_contains "$OUT" "ship --pr" "...and what to do"
shuttle -y merge
assert_status 1 "$RC" "merge of a release branch is refused too"
shuttle -n pr
assert_contains "$OUT" "-> release" "a pull request of a release branch goes to the release branch by default"
assert_not_contains "$OUT" "-> develop" "...not to the integration branch"
git checkout -q feat-one
shuttle -n merge
assert_status 0 "$RC" "a task branch still merges into the integration branch"
assert_contains "$OUT" "merge into: develop" "...as before"

finish
