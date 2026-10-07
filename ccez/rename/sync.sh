#!/bin/sh
# Brings upstream T3 Code into main, renamed.
#
#   ccez/rename/sync.sh            regenerate upstream-cz and merge it into main
#
# 1. upstream-cz gets one new commit whose tree is the codemod applied to
#    upstream/main. Its parent is the previous snapshot, so the diff main
#    merges is exactly upstream's new changes, already renamed.
# 2. main merges upstream-cz. Paths main dropped (map.ts droppedPaths) stay
#    dropped when upstream edits them or adds files under them.
# 3. The rename check runs on the result.
# Conflicts stop the script with the merge in progress, for a human or agent
# to resolve, then `git commit`.
set -eu
repo=$(git rev-parse --show-toplevel)
here="$repo/ccez/rename"
cd "$repo"
test -z "$(git status --porcelain --untracked-files=no)" || { echo "sync: main has uncommitted changes" >&2; exit 1; }
git fetch --quiet upstream
upstream_sha=$(git rev-parse upstream/main)

wt=$(mktemp -d "${TMPDIR:-/tmp}/upstream-cz.XXXXXX")
trap 'git worktree remove --force "$wt" >/dev/null 2>&1 || true' EXIT
if git rev-parse --verify --quiet upstream-cz >/dev/null; then
  git worktree add --quiet "$wt" upstream-cz
  git -C "$wt" read-tree --reset -u upstream/main
else
  git worktree add --quiet -b upstream-cz "$wt" upstream/main
fi
# The codemod finishes with the repo's formatter, which needs upstream's deps.
(cd "$wt" && { pnpm install --frozen-lockfile --ignore-scripts --offline || pnpm install --frozen-lockfile --ignore-scripts; } >/dev/null)
node "$here/rename.ts" "$wt"
git -C "$wt" add -A
if git -C "$wt" diff --cached --quiet; then
  echo "sync: upstream-cz already matches upstream $upstream_sha"
else
  git -C "$wt" commit --quiet -m "upstream-cz: codemod of upstream $upstream_sha"
fi

git checkout --quiet main
# .gitattributes marks fork-owned files merge=ours; the driver keeps main's copy.
git config merge.ours.driver true
# --no-commit even when clean: upstream's new files under a dropped path merge
# in without a conflict and must come out before the merge is committed.
merged=true
git merge --no-commit --no-ff upstream-cz || merged=false
dropped=$(node -e 'import("'"$here"'/map.ts").then(m => console.log(m.droppedPaths.join("\n")))')
for path in $dropped; do git rm -rqf --ignore-unmatch -- "$path"; done
if ! $merged || test -n "$(git diff --name-only --diff-filter=U)"; then
  echo "sync: merge stopped on conflicts; dropped paths re-removed. Resolve the rest, then git commit." >&2
  exit 1
fi
git commit --quiet --no-edit
"$here/check"
