#!/usr/bin/env bash
# Times agent-style disk work in a folder, to compare drives and filesystems
# (FLEET.md, "Agent work drive"):
#
#   bash ~/SWE/czcode/ccez/hosts/disk-bench.sh /data
#
# 1. pnpm install: czcode's dependencies linked from a warm store on that
#    drive into a fresh node_modules (what every new worktree does).
# 2. cargo build: rfcheck from clean, target dir on that drive, 2 jobs,
#    no sccache.
# Prints seconds and disk used for each, and removes what it made.
set -euo pipefail
dir=${1:?usage: disk-bench.sh <folder on the drive to test>}
work="$dir/cz-disk-bench.$$"
# shellcheck disable=SC1091
. "$HOME/.config/vite-plus/env"
export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT
seconds() {
  local start=$EPOCHREALTIME
  "$@" > "$work/last.log" 2>&1 || { tail -5 "$work/last.log" >&2 && return 1; }
  echo "$EPOCHREALTIME - $start" | bc
}

git clone -q --depth 1 "file://$HOME/SWE/czcode" "$work/czcode"
cd "$work/czcode"
# Warm the store on this drive, then time a fresh node_modules from it.
vp i -- --store-dir "$work/store" > /dev/null 2>&1
rm -rf node_modules apps/*/node_modules packages/*/node_modules
t=$(seconds vp i -- --offline --store-dir "$work/store")
echo "pnpm install (warm store): ${t%.*}s, node_modules $(du -sh node_modules | cut -f1)"

git clone -q --depth 1 "file://$HOME/SWE/rfcheck" "$work/rfcheck"
cd "$work/rfcheck"
t=$(seconds env RUSTC_WRAPPER= CARGO_TARGET_DIR="$work/target" cargo build -j 2)
echo "cargo build rfcheck: ${t%.*}s, target $(du -sh "$work/target" | cut -f1)"
echo "Load during the run: $(cut -d' ' -f1-3 /proc/loadavg)"
