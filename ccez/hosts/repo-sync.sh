#!/usr/bin/env bash
# Keeps this host's checkouts in step with repos.txt. Runs nightly as the
# cz-job-sync host job (host-jobs.sh); run it by hand any time:
#
#   bash ~/SWE/czcode/ccez/hosts/repo-sync.sh
#
# Clones what's missing, fetches everything, and fast-forwards a checkout
# whose branch is behind its upstream when it has no local changes. It never
# discards work: dirty, diverged, unpushed, or off-branch checkouts are listed
# for the owner instead. One exception: a pnpm-lock.yaml that is the only
# change is `vp i` churn, so it's restored before fast-forwarding.
# Also lists checkouts under ~/SWE and ~/ResumeProjects that repos.txt
# doesn't know, since those exist on this machine only. Every repo in
# repos.txt becomes a cz project here, so threads can run on any host and
# clients show one project per repo across machines (grouped by git origin).
#
# Exit status: 0 all current, 2 something needs the owner, 1 clones or
# fetches failed.
set -uo pipefail
# macOS has no timeout(1); perl's alarm does the same (exit 142 when it fires).
command -v timeout > /dev/null ||
  timeout() { perl -e 'alarm shift; exec @ARGV or die "exec $ARGV[0]: $!\n"' "$@"; }
manifest="$(cd "$(dirname "$0")" && pwd)/repos.txt"
cd "$HOME" || exit 1

attention=()
failed=0
cloned=0
forwarded=0
restored=0
total=0
note() { attention+=("$1: $2"); }

while read -r path url; do
  total=$((total + 1))
  case "$url" in *://*) ;; *) url="https://github.com/$url.git" ;; esac
  if [ ! -e "$path" ]; then
    mkdir -p "$(dirname "$path")"
    if timeout 1800 git clone -q "$url" "$path" < /dev/null; then
      cloned=$((cloned + 1))
      echo "cloned $path"
    else
      failed=$((failed + 1))
      note "$path" "clone failed"
    fi
    continue
  fi
  if [ ! -d "$path/.git" ]; then
    note "$path" "exists but isn't a git checkout"
    continue
  fi
  if ! timeout 300 git -C "$path" fetch -q --prune origin < /dev/null 2> /dev/null; then
    failed=$((failed + 1))
    note "$path" "fetch failed"
    continue
  fi
  branch=$(git -C "$path" symbolic-ref -q --short HEAD) || {
    note "$path" "detached HEAD"
    continue
  }
  git -C "$path" rev-parse -q --verify '@{upstream}' > /dev/null || {
    note "$path" "branch $branch has no upstream"
    continue
  }
  read -r ahead behind < <(git -C "$path" rev-list --left-right --count 'HEAD...@{upstream}')
  changes=$(git -C "$path" status --porcelain --untracked-files=no)
  if [ "$changes" = " M pnpm-lock.yaml" ]; then
    git -C "$path" checkout -q -- pnpm-lock.yaml && changes="" && restored=$((restored + 1))
  fi
  [ "$branch" = main ] || [ "$branch" = master ] || note "$path" "on branch $branch"
  if [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
    note "$path" "diverged from upstream ($ahead ahead, $behind behind)"
  elif [ "$ahead" -gt 0 ]; then
    note "$path" "$ahead unpushed commit(s)"
  fi
  if [ -n "$changes" ]; then
    dirty="$(wc -l <<< "$changes") uncommitted change(s)"
    [ "$behind" -eq 0 ] || dirty+=", $behind commits behind"
    note "$path" "$dirty"
  elif [ "$behind" -gt 0 ] && [ "$ahead" -eq 0 ]; then
    if git -C "$path" merge -q --ff-only '@{upstream}' > /dev/null 2>&1; then
      forwarded=$((forwarded + 1))
      echo "fast-forwarded $path ($behind commits)"
    else
      note "$path" "fast-forward failed (untracked files in the way?)"
    fi
  fi
done < <(grep -v '^#' "$manifest" | awk 'NF')

# Checkouts this manifest doesn't list (worktrees have a .git file; skip them).
known=$(grep -v '^#' "$manifest" | awk 'NF {print $1}')
while read -r git_dir; do
  path=${git_dir%/.git}
  grep -qxF "$path" <<< "$known" && continue
  origin=$(git -C "$path" remote get-url origin 2> /dev/null) || origin=""
  note "$path" "not in repos.txt (${origin:-no origin: exists only on this machine})"
done < <(find SWE ResumeProjects -maxdepth 5 -name .git -type d \
  -not -path '*/node_modules/*' -not -path '*/.repos/*' -not -path '*/.cache/*' 2> /dev/null | LC_ALL=C sort)

# Register the checkouts as cz projects, once each (cz refuses duplicates).
registered="$HOME/.local/state/cz-host/projects-registered"
mkdir -p "$(dirname "$registered")" && touch "$registered"
added=0
while read -r path; do
  if [ ! -d "$path/.git" ] || grep -qxF "$path" "$registered"; then continue; fi
  if out=$(cz project add --title "${path#*/}" "$HOME/$path" 2>&1) || grep -q 'already exists' <<< "$out"; then
    echo "$path" >> "$registered"
    grep -q 'already exists' <<< "$out" || added=$((added + 1))
  else
    note "$path" "couldn't add as a cz project: $(tail -1 <<< "$out")"
  fi
done < <(grep -v '^#' "$manifest" | awk 'NF {print $1}')

for line in "${attention[@]}"; do echo "attention: $line"; done
summary="$total repos: $cloned cloned, $forwarded fast-forwarded, $added added as cz projects"
[ "$restored" -eq 0 ] || summary+=", $restored pnpm-lock churn restored"
summary+=", ${#attention[@]} need attention"
[ "$failed" -eq 0 ] || summary+=", $failed failed"
echo "$summary"
[ "$failed" -eq 0 ] || exit 1
[ "${#attention[@]}" -eq 0 ] || exit 2
