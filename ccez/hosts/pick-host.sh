#!/usr/bin/env bash
# Picks the host for new heavy work: the least loaded Linux host with the
# hardware it needs. Works from any host or the Mac.
#
#   bash ~/SWE/czcode/ccez/hosts/pick-host.sh [cpu|gpu|emulator] [--list]
#
#   cpu       long builds and other CPU work (any Linux host; the default)
#   gpu       Blender GPU renders, Whisper, local models, shader work
#   emulator  Android emulator testing at realistic frame rates
#
# Prints "<host> <ssh login>", for example "art-ms-7917 art@art-ms-7917";
# --list also prints every candidate and why. Load is the 5-minute load per
# CPU thread, plus a penalty for heavy swap or low free memory. A host that's
# asleep counts as idle: it's woken (Wake-on-LAN) when picked. Hardware tags
# are the fourth column of hosts.txt.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
need=cpu
list=false
for arg in "$@"; do
  case "$arg" in
    cpu | gpu | emulator) need=$arg ;;
    --list) list=true ;;
    *) echo "usage: $0 [cpu|gpu|emulator] [--list]" >&2 && exit 2 ;;
  esac
done

# One line per candidate: score, host, login, note.
probe() {
  local host=$1 login=$2 stats
  # shellcheck disable=SC2016 # expands on the host
  # Linux reads /proc; a Mac host (a MacBook in the fleet) answers through
  # sysctl and vm_stat. Both print: threads, 5-minute load, "GB-free swap%".
  local cmd='if [ -r /proc/loadavg ]; then nproc; cut -d" " -f2 /proc/loadavg;
    awk "/^MemAvailable:/ {a = \$2} /^SwapTotal:/ {t = \$2} /^SwapFree:/ {f = \$2}
      END {print int(a / 1048576), (t > 0 ? int((t - f) * 100 / t) : 0)}" /proc/meminfo;
    else sysctl -n hw.ncpu; sysctl -n vm.loadavg | awk "{print \$3}";
    free=$(vm_stat | awk "/page size/ {p = \$8} /Pages (free|inactive|speculative)/ {gsub(/\\./, \"\", \$NF); n += \$NF} END {print int(n * p / 1073741824)}");
    sysctl -n vm.swapusage | awk -v free="$free" "{t = \$3 + 0; u = \$6 + 0; print free, (t > 0 ? int(u * 100 / t) : 0)}"; fi'
  if [ "$host" = "$(this_host)" ]; then
    stats=$(bash -c "$cmd")
  else
    # shellcheck disable=SC2029 # $cmd is meant to run there
    stats=$(ssh "${ssh_opts[@]}" "$login" "$cmd" 2> /dev/null)
  fi
  if [ -z "$stats" ]; then
    # Asleep (or down): idle if it wakes.
    online "$host" || echo "0.00 $host $login asleep, wakes when picked"
    return
  fi
  awk -v host="$host" -v login="$login" 'NR == 1 {threads = $1} NR == 2 {load = $1}
    NR == 3 {
      score = load / threads; note = sprintf("load %.1f on %d threads, %d GB free, swap %d%% used", load, threads, $1, $2)
      if ($2 > 50) score += 1
      if ($1 < 4) score += 1
      printf "%.2f %s %s %s\n", score, host, login, note
    }' <<< "$stats"
}

candidates=$(awk -v need="$need" '!/^#/ && NF >= 2 && $2 != "-" &&
    (need == "cpu" || index("," $4 ",", "," need ",")) {print $1, $2}' "$hosts_dir/hosts.txt" |
  { while read -r host login; do probe "$host" "$login" & done; wait; } | sort -n)
[ -n "$candidates" ] || { echo "No reachable host has '$need'." >&2 && exit 1; }
$list && awk '{printf "%-12s %s  ", $2, $1; for (i = 4; i <= NF; i++) printf "%s ", $i; print ""}' <<< "$candidates" >&2
read -r _ host login note <<< "$(head -1 <<< "$candidates")"
if [[ "$note" == asleep* ]]; then
  wake_host "$host" || { echo "$host is asleep and didn't wake." >&2 && exit 1; }
fi
echo "$host $login"
