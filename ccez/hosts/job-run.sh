#!/usr/bin/env bash
# Runs one host job and records how it went, for fleet-status.sh and the
# morning brief. host-jobs.sh points each cz-job-<name> service here:
#
#   job-run.sh <name> <command> [args...]
#
# The job's exit status means: 0 fine, 2 something needs the owner (the job
# still ran), anything else the job failed. Its last line of output is the
# summary. Writes ~/.local/state/cz-host/jobs/<name>.json (last run),
# <name>.log (its output) and appends to history.jsonl.
set -uo pipefail
name=$1
shift
state="$HOME/.local/state/cz-host/jobs"
mkdir -p "$state"
started=$(date -Is)
"$@" 2>&1 | tee "$state/$name.log"
code=${PIPESTATUS[0]}
case $code in
  0) status=ok ;;
  2) status=attention ;;
  *) status=failed ;;
esac
summary=$(grep -v '^[[:space:]]*$' "$state/$name.log" | tail -1 | cut -c1-300)
record=$(jq -cn --arg name "$name" --arg host "$(hostname)" --arg status "$status" \
  --arg startedAt "$started" --arg finishedAt "$(date -Is)" --argjson exitCode "$code" \
  --arg summary "$summary" \
  '{$name, $host, $status, $startedAt, $finishedAt, $exitCode, $summary}')
echo "$record" > "$state/$name.json.tmp" && mv "$state/$name.json.tmp" "$state/$name.json"
echo "$record" >> "$state/history.jsonl"
tail -n 1000 "$state/history.jsonl" > "$state/history.jsonl.tmp" && mv "$state/history.jsonl.tmp" "$state/history.jsonl"
exit "$code"
