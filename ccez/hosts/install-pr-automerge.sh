#!/usr/bin/env bash
# Installs pr-automerge.sh as a user timer (every 10 minutes) on this Linux
# host, so the owner's PRs merge themselves once their checks pass. Run it on
# one host only (f-ms-7917). Needs a working `gh` login for the owner.
#
#   bash ~/SWE/czcode/ccez/hosts/install-pr-automerge.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
gh auth status > /dev/null 2>&1 || { echo "gh isn't logged in here." >&2; exit 1; }
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/pr-automerge.service" << UNIT
[Unit]
Description=Merge the owner's green pull requests across their repos (ccez/hosts/pr-automerge.sh)

[Service]
Type=oneshot
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$here/pr-automerge.sh
UNIT
cat > "$HOME/.config/systemd/user/pr-automerge.timer" << 'UNIT'
[Unit]
Description=Every 10 minutes: merge the owner's green pull requests

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now pr-automerge.timer
systemctl --user list-timers pr-automerge.timer --no-pager
