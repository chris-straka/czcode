#!/usr/bin/env bash
# System tuning for a Linux agent host. linux.sh runs it with sudo; to apply it
# to a host that's already set up:
#
#   sudo bash ~/SWE/czcode/ccez/hosts/tune-host-linux.sh
#
# Safe to re-run, and safe while agents work: nothing here restarts cz-host,
# and Docker restarts only when no containers are running.
#
# - zram: compressed swap in RAM, used before the disk (fast; helps most on
#   hard drives).
# - Disk swap file of min(RAM, 16 GB), the backstop before the out-of-memory
#   killer.
# - Higher file-watcher limits (dev servers, cargo watch, editors).
# - A cap on journald and Docker logs, so logs can't fill the disk.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
in_wsl=false
grep -qi microsoft /proc/version && in_wsl=true
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ram_mb=$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)

if ! $in_wsl; then # WSL manages memory and swap through .wslconfig on Windows
  step "zram (compressed swap in RAM)"
  dpkg -s systemd-zram-generator > /dev/null 2>&1 ||
    DEBIAN_FRONTEND=noninteractive apt-get install -yq systemd-zram-generator > /dev/null
  cat > /etc/systemd/zram-generator.conf << 'CONF'
# From ccez/hosts/tune-host-linux.sh: half of RAM (at most 16 GB), zstd,
# used before the disk swap file.
[zram0]
zram-size = min(ram / 2, 16384)
compression-algorithm = zstd
swap-priority = 100
CONF
  systemctl daemon-reload
  # The package starts zram with its own default size; restart to apply ours
  # (a no-op when the size already matches).
  zram_want=$(((ram_mb / 2 < 16384 ? ram_mb / 2 : 16384) * 1048576))
  zram_have=$(cat /sys/block/zram0/disksize 2> /dev/null || echo 0)
  if [ "$zram_have" -ne "$zram_want" ]; then
    systemctl restart systemd-zram-setup@zram0.service
    systemctl start dev-zram0.swap
  fi
  swapon --show

  step "Disk swap file"
  want_mb=$((ram_mb < 16384 ? ram_mb : 16384))
  have_mb=$(swapon --show=NAME,SIZE --bytes --noheadings 2> /dev/null |
    awk '$1 == "/swap.img" {print int($2 / 1048576)}')
  have_mb=${have_mb:-0}
  if [ "$have_mb" -ge $((want_mb * 9 / 10)) ]; then
    echo "/swap.img is ${have_mb} MB; keeping it."
  else
    used_mb=$(swapon --show=NAME,USED --bytes --noheadings 2> /dev/null |
      awk '$1 == "/swap.img" {print int($2 / 1048576)}')
    free_mb=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
    if [ "${used_mb:-0}" -gt $((free_mb / 2)) ]; then
      echo "/swap.img holds ${used_mb} MB right now; resize it later when the host is quieter."
    else
      [ "$have_mb" -eq 0 ] || swapoff /swap.img
      rm -f /swap.img
      fallocate -l "${want_mb}M" /swap.img
      chmod 600 /swap.img
      mkswap /swap.img > /dev/null
      swapon /swap.img
      grep -q '^/swap.img' /etc/fstab || echo '/swap.img none swap sw 0 0' >> /etc/fstab
      echo "/swap.img is now ${want_mb} MB."
    fi
  fi
fi

step "Kernel settings"
cat > /etc/sysctl.d/90-cz-host.conf << 'CONF'
# From ccez/hosts/tune-host-linux.sh.
# With zram first in line, swapping out is cheap, so swap earlier.
vm.swappiness = 100
vm.page-cluster = 0
# Agents run many file watchers (dev servers, cargo watch, editors).
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 1024
CONF
sysctl -q --system

step "Log size caps"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/cz-host.conf
systemctl restart systemd-journald
if command -v docker > /dev/null 2>&1 && [ ! -e /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "50m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  if [ -z "$(docker ps -q 2> /dev/null)" ]; then
    systemctl restart docker 2> /dev/null || true
  else
    echo "Docker log caps apply after Docker's next restart (containers are running)."
  fi
fi
echo "Tuning done."
