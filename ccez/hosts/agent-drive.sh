#!/usr/bin/env bash
# Moves the fast-growing folders off the system drive onto the host's agent
# drive, leaving a symlink at the old path so nothing needs reconfiguring.
# Runs nightly as the cz-job-drive host job (host-jobs.sh), and by hand:
#
#   bash ~/SWE/czcode/ccez/hosts/agent-drive.sh            # move what's idle
#   bash ~/SWE/czcode/ccez/hosts/agent-drive.sh --dry-run  # only list
#
# The agent drive is /data (or CZ_AGENT_DRIVE) when it's a separate,
# writable filesystem; hosts without one skip all of this. A folder moves to
# <drive>/<user>/<same path under ~>:
#
# - mediaforge's store (~/.mediaforge) and the model caches (Hugging Face,
#   torch, Whisper, gk-stylize), plus uv's and sccache's caches;
# - the Android SDK and emulator images (~/Android, ~/.android/avd);
# - Python `.venv` folders over 1 GB under ~/SWE and ~/ResumeProjects, and
#   ccez-llm's Rust `target` folder, the one build output the owner keeps
#   (sweep-builds.sh deletes the rest).
#
# A folder moves only while nothing uses it: no process has a file in it
# open or mapped, or works inside it, and for a build folder no cargo or
# rustc runs in its repo. Busy ones wait for the next run.
#
# Exit status: 0 nothing left to move, 2 some folders were busy, 1 failed.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
dry=false
[ "${1:-}" = --dry-run ] && dry=true

drive=${CZ_AGENT_DRIVE:-/data}
if ! mountpoint -q "$drive" || [ "$(stat -c %d "$drive")" = "$(stat -c %d "$HOME")" ] || [ ! -w "$drive" ]; then
  echo "No agent drive here ($drive isn't a separate, writable drive); nothing to move."
  exit 0
fi
dest_root="$drive/$USER"
cd "$HOME" || exit 1

# Folders to move, relative to ~.
candidates() {
  for path in .mediaforge .cache/huggingface .cache/torch .cache/whisper .cache/gk-stylize \
    .cache/uv .cache/sccache Android .android/avd; do
    echo "$path"
  done
  find SWE ResumeProjects -maxdepth 7 \( -name node_modules -o -name .git \) -prune -o \
    \( -type d -o -type l \) \( -name target -o -name .venv \) -print -prune 2> /dev/null |
    while read -r path; do
      # Moved ones are links now; they're revisited to keep git ignoring them.
      [ -L "$path" ] && echo "$path" && continue
      case "$path" in
        SWE/ccez-llm/*/target) [ -f "$(dirname "$path")/Cargo.toml" ] && echo "$path" ;;
        */.venv) [ "$(du -sm "$path" | cut -f1)" -ge 1024 ] && echo "$path" ;;
      esac
    done
}


# Ignore rules like `/target/` match only folders, so git would list the
# symlink as a new file (and `git add -A` would commit it). Exclude it in
# the repo's own info/exclude.
exclude_link() {
  local top rel exclude
  top=$(git -C "$(dirname "$1")" rev-parse --show-toplevel 2> /dev/null) || return 0
  rel=${HOME}/$1
  rel=/${rel#"$top"/}
  exclude=$(git -C "$top" rev-parse --path-format=absolute --git-path info/exclude)
  mkdir -p "$(dirname "$exclude")"
  grep -qxF "$rel" "$exclude" 2> /dev/null || echo "$rel" >> "$exclude"
}

moved=()
busy=()
failed=0
while read -r path; do
  dest="$dest_root/$path"
  if [ -L "$path" ]; then
    [ "$(readlink "$path")" = "$dest" ] && ! $dry && exclude_link "$path"
    continue
  fi
  [ -d "$path" ] || continue
  size=$(du -sh "$path" 2> /dev/null | cut -f1)
  reason=$(in_use "$HOME/$path" "$HOME/$(dirname "$path")" 'cargo|rustc|cc|ld|clippy-driver|rust-analyzer')
  if [ -n "$reason" ]; then
    busy+=("$path ($size, used by $reason)")
    continue
  fi
  if $dry; then
    echo "would move ~/$path ($size) to $dest"
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  # Copy while it's idle, check it's still idle, catch up, then swap in the
  # link. The old folder goes only once the link is in place.
  if rsync -aH --delete "$path/" "$dest/" && [ -z "$(in_use "$HOME/$path")" ] &&
    rsync -aH --delete "$path/" "$dest/" && mv "$path" "$path.moving" &&
    ln -s "$dest" "$path"; then
    rm -rf "$path.moving"
    exclude_link "$path"
    moved+=("$path ($size)")
    echo "moved ~/$path ($size) to $dest"
  else
    [ -e "$path.moving" ] && [ ! -e "$path" ] && mv "$path.moving" "$path"
    failed=$((failed + 1))
    echo "couldn't move ~/$path; left it in place"
  fi
done < <(candidates)

for line in "${busy[@]}"; do echo "busy, next time: ~/$line"; done
free=$(df -h --output=avail,pcent "$HOME" | tail -1 | awk '{print $1 " free (" $2 " used)"}')
echo "${#moved[@]} folder(s) moved to $drive, ${#busy[@]} busy, $failed failed; system drive $free."
[ "$failed" -eq 0 ] || exit 1
[ "${#busy[@]}" -eq 0 ] || exit 2
