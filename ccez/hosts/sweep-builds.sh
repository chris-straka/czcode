#!/usr/bin/env bash
# Deletes build output the owner doesn't keep: the repos are the record, so
# hosts hold as little as they can. Runs weekly as the cz-job-sweep host job
# (host-jobs.sh), and by hand:
#
#   bash ~/SWE/czcode/ccez/hosts/sweep-builds.sh               # untouched 7 days
#   bash ~/SWE/czcode/ccez/hosts/sweep-builds.sh --days 0      # all of it, now
#   bash ~/SWE/czcode/ccez/hosts/sweep-builds.sh --dry-run     # only list
#
# Under ~/SWE and ~/ResumeProjects it deletes:
# - Rust `target` folders (on the agent drive too, when agent-drive.sh moved
#   them there);
# - Gradle `build` and `.gradle` folders;
# - `node_modules` of repos nobody has touched for a week (never the czcode
#   checkout, which is developed every day);
# - git worktrees that are finished: no changes, their commit pushed,
#   untouched for at least a day, and no cz thread pointing at them.
#
# It never touches ccez-llm, and skips anything in use: a process working in
# it or holding its files, a build running in its repo, or a running cz
# thread's project. Model caches and weights aren't build output and stay.
#
# Exit status: 0 done, 2 some were in use (they go next time), 1 failed.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
days=7
dry=false
while [ $# -gt 0 ]; do
  case "$1" in
    --days) days=$2 && shift ;;
    --dry-run) dry=true ;;
    *) echo "usage: $0 [--days N] [--dry-run]" >&2 && exit 2 ;;
  esac
  shift
done
cd "$HOME" || exit 1
db="$HOME/.cz/userdata/statev2.sqlite"
spared='SWE/ccez-llm'
tools='cargo|rustc|cc|ld|clippy-driver|rust-analyzer|gradle|java|node|npm|pnpm|vite|tsc|bun'
free_before=$(df --output=avail -B1 "$HOME" | tail -1)

# Project folders of running cz threads, except the umbrella folders (~/SWE
# and the like), which hold every repo.
busy_projects=$(cz thread list --json 2> /dev/null |
  jq -r '.[] | select(.busy // .running) | .projectId' | sort -u |
  while read -r id; do
    sqlite3 "file:$db?mode=ro" "SELECT workspace_root FROM projection_projects WHERE project_id = '$id'" 2> /dev/null
  done | grep -vxE "$HOME|$HOME/SWE|$HOME/ResumeProjects")

in_busy_project() {
  local project
  while read -r project; do
    [ -n "$project" ] && [[ "$1/" == "$project/"* ]] && return 0
  done <<< "$busy_projects"
  return 1
}

# Whether anything in the folder changed within the last $1 days.
touched_within() {
  [ "$1" -gt 0 ] && find "$2" -newermt "-$1 days" -print -quit 2> /dev/null | grep -q .
}

candidates() {
  find SWE ResumeProjects -maxdepth 7 -name .git -prune -o \
    \( -type d -o -type l \) \( -name target -o -name build -o -name .gradle -o -name node_modules \) \
    -print -prune 2> /dev/null |
    while read -r path; do
      parent=$(dirname "$path")
      case "$path" in
        "$spared"/* | "$spared") continue ;;
        */target) [ -f "$parent/Cargo.toml" ] ;;
        */build) compgen -G "$parent/build.gradle*" > /dev/null || compgen -G "$parent/settings.gradle*" > /dev/null ;;
        */.gradle) compgen -G "$parent/*.gradle*" > /dev/null ;;
        */node_modules) [ -f "$parent/package.json" ] && [ "$parent" != SWE/czcode ] ;;
      esac && echo "$path"
    done
}

deleted=()
busy=()
failed=0
remove() {
  local path=$1 size=$2
  if $dry; then
    echo "would delete ~/$path ($size)"
    return
  fi
  local real
  real=$(readlink -f "$path")
  if rm -rf "${real:?}" && rm -rf "$path"; then
    deleted+=("$path ($size)")
    echo "deleted ~/$path ($size)"
  else
    failed=$((failed + 1))
    echo "couldn't delete ~/$path"
  fi
}

while read -r path; do
  repo=$(git -C "$(dirname "$path")" rev-parse --show-toplevel 2> /dev/null || dirname "$HOME/$path")
  size=$(du -shL "$path" 2> /dev/null | cut -f1)
  age=$days
  [[ "$path" == */node_modules ]] && [ "$age" -lt 7 ] && age=7
  touched_within "$age" "$path/" && continue
  if in_busy_project "$repo"; then
    busy+=("$path ($size, a running thread's project)")
    continue
  fi
  reason=$(in_use "$HOME/$path" "$repo" "$tools")
  if [ -n "$reason" ]; then
    busy+=("$path ($size, used by $reason)")
    continue
  fi
  remove "$path" "$size"
done < <(candidates)

# Finished worktrees.
while read -r top; do
  git -C "$top" worktree list --porcelain | awk '/^worktree / {print substr($0, 10)}' | tail -n +2 |
    while read -r tree; do
      [[ "$tree" == "$HOME/"* && "$tree" != "$HOME/.local/"* && "$tree" != "$HOME/$spared"* ]] || continue
      [ -d "$tree" ] || continue
      rel=${tree#"$HOME/"}
      size=$(du -sh "$tree" 2> /dev/null | cut -f1)
      age=$days
      [ "$age" -lt 1 ] && age=1
      touched_within "$age" "$tree/" && continue
      [ -z "$(git -C "$tree" status --porcelain 2> /dev/null)" ] || continue
      git -C "$tree" branch -r --contains HEAD 2> /dev/null | grep -q . || continue
      if sqlite3 "file:$db?mode=ro" "SELECT 1 FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL AND payload_json LIKE '%\"worktreePath\":\"$tree\"%' LIMIT 1" 2> /dev/null | grep -q 1; then
        continue
      fi
      reason=$(in_use "$tree" "$tree" "$tools")
      if [ -n "$reason" ]; then
        echo "busy: worktree ~/$rel ($size, used by $reason)"
        continue
      fi
      if $dry; then
        echo "would remove worktree ~/$rel ($size)"
      elif git -C "$top" worktree remove "$tree" 2> /dev/null; then
        echo "removed worktree ~/$rel ($size)"
      else
        echo "couldn't remove worktree ~/$rel"
      fi
    done
done < <(find SWE ResumeProjects -maxdepth 4 -name .git -type d 2> /dev/null | sed 's#/.git$##' | sed "s#^#$HOME/#")

for line in "${busy[@]}"; do echo "in use, next time: ~/$line"; done
freed=$((($(df --output=avail -B1 "$HOME" | tail -1) - free_before) / 1073741824))
echo "${#deleted[@]} build folder(s) deleted, ${#busy[@]} in use, $failed failed; ${freed} GB freed, $(df -h --output=avail "$HOME" | tail -1 | tr -d ' ') free."
[ "$failed" -eq 0 ] || exit 1
[ "${#busy[@]}" -eq 0 ] || exit 2
