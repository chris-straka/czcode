#!/bin/sh
# Disables the upstream workflows the fork cannot run: they need upstream's
# secrets or services (Expo/EAS, AUR, Vercel, signing, release apps, Cursor,
# vouch lists). Disabled workflows never start, so they neither fail nor sit
# queued, and GitHub keeps them disabled across upstream syncs because the
# state belongs to the workflow file's path, not its contents.
#
#   ccez/ci/disable-upstream-workflows.sh          disable them on the fork
#   ccez/ci/disable-upstream-workflows.sh enable   turn them back on
#
# Rerun after a sync that adds a workflow needing upstream-only secrets, and
# add it here. Runner labels are handled by the codemod (ccez/rename/map.ts).
set -eu
repo=chris-straka/czcode
action=${1:-disable}
for workflow in \
  cursor-hygiene-webhook.yml \
  desktop-macos-preview.yml \
  desktop-macos-preview-publish.yml \
  mobile-eas-preview.yml \
  mobile-eas-production.yml \
  pr-vouch.yml \
  publish-aur.yml \
  release.yml \
  release-desktop.yml \
  web-preview.yml; do
  gh api --silent -X PUT "repos/$repo/actions/workflows/$workflow/$action"
  echo "$action: $workflow"
done
