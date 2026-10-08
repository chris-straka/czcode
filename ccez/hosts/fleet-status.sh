#!/usr/bin/env bash
# Every host's jobs at a glance: the last run of each host job, which cz
# release it runs, and hosts that can't be reached. For the morning brief and
# for the owner; works from any host, the Mac included:
#
#   bash ~/SWE/czcode/ccez/hosts/fleet-status.sh          # text, problems first
#   bash ~/SWE/czcode/ccez/hosts/fleet-status.sh --json   # one object per host
#
# Doesn't wake sleeping hosts; they show as unreachable.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
json=false
[ "${1:-}" = --json ] && json=true

# One host's report, as JSON: {host, reachable, release, jobs: [...]}.
read_host() {
  local host=$1 login report
  # shellcheck disable=SC2016 # runs on the host
  local remote='cat ~/.local/state/cz-host/jobs/*.json 2> /dev/null | jq -cs "{release: \"$(cut -c1-10 ~/.local/lib/cz-host/cz/current/.cz-release 2> /dev/null)\", jobs: .}"'
  login=$(host_field "$host" 2)
  if [ "$host" = "$(this_host)" ]; then
    report=$(bash -c "$remote")
  elif [ "$login" = - ]; then
    online "$host" && report='{"jobs": [], "note": "no SSH; online"}'
  else
    # shellcheck disable=SC2029 # $remote is meant to run there
    report=$(ssh "${ssh_opts[@]}" "$login" "$remote" 2> /dev/null)
  fi
  if [ -n "${report:-}" ]; then
    jq -c --arg host "$host" '{host: $host, reachable: true} + .' <<< "$report"
  else
    jq -cn --arg host "$host" '{host: $host, reachable: false, jobs: []}'
  fi
}

reports=$(awk '!/^#/ && NF {print $1}' "$hosts_dir/hosts.txt" | { while read -r host; do read_host "$host" & done; wait; })
if $json; then
  jq -s 'sort_by(.host)' <<< "$reports"
  exit 0
fi
jq -rs '
  sort_by(.host)[] |
  if .reachable | not then "\(.host): can'"'"'t be reached (asleep or down)"
  else
    "\(.host)" + (if (.release // "") != "" then "  cz \(.release)" else "" end) + (if .note then "  \(.note)" else "" end),
    (.jobs | sort_by(.status != "failed", .status != "attention", .name)[] |
      "  \(.status | .[0:9] | . + " " * (10 - length))\(.name | . + " " * (13 - length))\(.finishedAt[5:16] | sub("T"; " "))  \(.summary)")
  end' <<< "$reports"
