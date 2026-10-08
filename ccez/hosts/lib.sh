# shellcheck shell=bash
# Shared by the host jobs: which host this is, how to reach the others, and
# waking one that sleeps. Source it; it defines functions only.

hosts_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

# This machine's name in hosts.txt (Tailscale names are lower case). -s drops
# the ".local" that macOS adds.
this_host() { hostname -s | tr '[:upper:]' '[:lower:]'; }

# host_field <host> <column>: 2 is the SSH login, 3 the backup host.
host_field() {
  awk -v host="$1" -v col="$2" '!/^#/ && $1 == host {print $col}' "$hosts_dir/hosts.txt"
}

# Every host in hosts.txt but this one.
other_hosts() {
  awk -v me="$(this_host)" '!/^#/ && NF && $1 != me {print $1}' "$hosts_dir/hosts.txt"
}

# online <host>: whether Tailscale sees it now.
online() {
  [ "$1" = "$(this_host)" ] && return 0
  tailscale status --json 2> /dev/null | jq -e --arg host "$1" \
    '[.Peer[] | select((.DNSName | split(".")[0]) == $host)][0].Online == true' > /dev/null
}

# wake_host <host>: send Wake-on-LAN (the MAC cz learned, in wake-hosts.json),
# then wait up to 3 minutes for SSH. Fails if it doesn't come up.
wake_host() {
  local host=$1 login wake
  login=$(host_field "$host" 2)
  ssh "${ssh_opts[@]}" "$login" true 2> /dev/null && return 0
  wake=$(jq -c --arg host "$host" '[.[] | select((.dnsName | split(".")[0]) == $host)][0] // empty' \
    "$HOME/.cz/userdata/wake-hosts.json" 2> /dev/null)
  if [ -n "$wake" ]; then
    python3 - "$(jq -r .mac <<< "$wake")" "$(jq -r .broadcast <<< "$wake")" << 'PY'
import socket, sys
mac = bytes.fromhex(sys.argv[1].replace(":", ""))
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.sendto(b"\xff" * 6 + mac * 16, (sys.argv[2], 9))
PY
  fi
  for _ in $(seq 18); do
    sleep 10
    ssh "${ssh_opts[@]}" "$login" true 2> /dev/null && return 0
  done
  return 1
}

# in_use <folder> [<repo> <tools regex>]: why the folder is in use, or nothing.
# In use means a process works inside it or has a file in it open or mapped
# (under its real path too, when it's a symlink), or a build tool matching
# the regex runs in the repo.
in_use() {
  local dir=$1 repo=${2:-} tools=${3:-} real proc cwd
  real=$(readlink -f "$dir")
  for proc in /proc/[0-9]*; do
    [ -O "$proc" ] || continue
    cwd="$(readlink "$proc/cwd" 2> /dev/null)/"
    if [[ "$cwd" == "$dir/"* || "$cwd" == "$real/"* ]] ||
      find "$proc/fd" \( -lname "$dir/*" -o -lname "$real/*" \) 2> /dev/null | grep -q . ||
      grep -qF -e " $dir/" -e " $real/" "$proc/maps" 2> /dev/null; then
      echo "$(cat "$proc/comm" 2> /dev/null) (pid ${proc#/proc/})"
      return
    fi
    if [ -n "$repo" ] && [[ "$cwd" == "$repo/"* ]] && grep -qxE "$tools" "$proc/comm" 2> /dev/null; then
      echo "$(cat "$proc/comm") (pid ${proc#/proc/}) running in its repo"
      return
    fi
  done
}
