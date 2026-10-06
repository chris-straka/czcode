#!/usr/bin/env bash
# WINDOWS, FIRST TIME ONLY: open PowerShell, run `wsl --install`, restart the
# PC, open "Ubuntu" from the Start menu, and pick a username and password.
# On a PC running Ubuntu itself, open Terminal instead.
#
# Then copy this line into the terminal (right-click pastes):
#
# wget -qO /tmp/cz-host.sh https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh && bash /tmp/cz-host.sh
#
# Sets up this machine as a cz agent host: tools, Tailscale, cz built from this
# repo and kept running as a background service on the tailnet, the build
# tools in build-tools-linux.sh (Rust, Go, Java, Android, Blender, Docker...),
# and the Claude, Codex, and OpenCode logins (each prints a link or code to open on any
# device). Safe to re-run: finished steps are skipped, and re-running updates cz.
#
# On WSL it also turns on systemd, keeps WSL running after you log in to
# Windows, and stops Windows from sleeping while plugged in.
set -euo pipefail

REPO_URL=https://github.com/chris-straka/czcode.git
CHECKOUT="$HOME/SWE/czcode"
UNIT=cz-host.service

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
have() { command -v "$1" > /dev/null 2>&1; }

[ "$(id -u)" -ne 0 ] || { echo "Run as your normal user, not root (sudo is used where needed)." >&2; exit 1; }
have apt-get || { echo "This script expects Ubuntu or Debian." >&2; exit 1; }
in_wsl=false
grep -qi microsoft /proc/version && in_wsl=true
if [ "$(ps -p 1 -o comm=)" != "systemd" ]; then
  if ! $in_wsl; then
    echo "systemd isn't running. Enable it and re-run." >&2
    exit 1
  fi
  # WSL runs systemd only when /etc/wsl.conf asks, and only after a restart.
  grep -q '^systemd *= *true' /etc/wsl.conf 2> /dev/null ||
    printf '\n[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf > /dev/null
  echo
  echo "WSL needs a restart to turn on systemd. After this window closes, open"
  echo "Ubuntu again and run the same command (press the up arrow to get it back)."
  read -r -p "Press Enter to restart WSL. " _ < /dev/tty
  /mnt/c/Windows/System32/wsl.exe --shutdown
  exit 0
fi

step "Base tools"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates build-essential python3 unzip jq > /dev/null
if ! have gh; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg |
    sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg status=none
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |
    sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq gh > /dev/null
fi

step "Node 24 and Vite+ (vp)"
if ! node --version 2> /dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs > /dev/null
fi
# Global npm tools (the coding agents) go to ~/.local, so no sudo.
npm config set prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
# shellcheck disable=SC2016 # written literally, for .bashrc to expand
grep -q '.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
[ -x "$HOME/.local/share/vite-plus/bin/vp" ] || curl -fsSL https://vite.plus | bash
# shellcheck disable=SC1091
. "$HOME/.config/vite-plus/env"
# Node comes from apt above; vp only builds.
vp env off > /dev/null 2>&1 || true

step "Tailscale"
have tailscale || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale status > /dev/null 2>&1; then
  echo "Sign this machine into your tailnet with the link below."
  # --ssh lets you (and agents on the Mac) open a shell here over the tailnet.
  sudo tailscale up --ssh
fi
# Lets cz configure Tailscale Serve without root.
sudo tailscale set --operator="$USER"
tailscale_name=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')

step "cz (built from $REPO_URL)"
if [ -d "$CHECKOUT/.git" ]; then
  git -C "$CHECKOUT" pull --ff-only
else
  mkdir -p "$(dirname "$CHECKOUT")"
  git clone "$REPO_URL" "$CHECKOUT"
fi
(cd "$CHECKOUT" && vp i && vp run --filter @cz/web --filter cz build)
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/cz" << SHIM
#!/usr/bin/env bash
# The cz CLI from $CHECKOUT (ccez/hosts/linux.sh). Update by re-running that script.
exec /usr/bin/node "$CHECKOUT/apps/server/dist/bin.mjs" "\$@"
SHIM
chmod +x "$HOME/.local/bin/cz"

if [ "${CZ_HOST_TOOLS:-1}" = 1 ]; then
  step "Build tools: Rust, Go, Java, Android, Blender, Docker and more (CZ_HOST_TOOLS=0 skips)"
  bash "$CHECKOUT/ccez/hosts/build-tools-linux.sh"
fi

step "Tune the host: zram, swap file, file-watcher limits, log caps"
sudo bash "$CHECKOUT/ccez/hosts/tune-host-linux.sh"

# A Linux PC on Ethernet sleeps when idle and wakes over the network: the
# Mac (or any cz server on the LAN) sends the Wake-on-LAN packet when needed.
sleep_minutes=0
wired=""
if ! $in_wsl; then
  wired=$(nmcli -t -f DEVICE,TYPE,STATE device 2> /dev/null |
    awk -F: '$2 == "ethernet" && $3 == "connected" {print $1; exit}')
  if [ -n "$wired" ] && sudo ethtool "$wired" 2> /dev/null | grep -q 'Supports Wake-on:.*g'; then
    sleep_minutes=${CZ_SLEEP_WHEN_IDLE_MINUTES:-30}
  fi
fi

step "cz as a background service on the tailnet"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$UNIT" << UNITFILE
[Unit]
Description=cz agent host (ccez/hosts/linux.sh)
After=network-online.target

[Service]
Environment=CZ_TAILSCALE_SERVE=1
Environment=CZ_SLEEP_WHEN_IDLE_MINUTES=$sleep_minutes
# Each agent runs in its own scope, so running out of memory ends that agent
# rather than the server and every other thread (AgentScopesService).
Environment=CZ_AGENT_SCOPES=1
# A process the kernel kills for memory doesn't stop the server with it.
OOMPolicy=continue
# Agents and builds open many files; systemd's default soft limit is 1024.
LimitNOFILE=1048576
# systemd's default PATH lacks the agents and toolchains installed in your
# home (rustup, a Go tarball in ~/.local/go, go install).
Environment=PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.local/go/bin:$HOME/go/bin:/usr/local/bin:/usr/bin:/bin
# Written by build-tools-linux.sh: PATH, JAVA_HOME, ANDROID_HOME and friends.
# Overrides the PATH above when present.
EnvironmentFile=-%h/.config/cz-host/environment
WorkingDirectory=%h
ExecStart=$HOME/.local/bin/cz serve --no-browser
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNITFILE
# Keeps the service running with nobody logged in.
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" > /dev/null
# Settings are edited only while cz is stopped, so it can't write over them.
# Codex uses this machine's own `codex login` ("existing"); the welcome wizard
# can otherwise pick "managed", which needs a second sign-in. New threads
# default to Claude Opus.
systemctl --user stop "$UNIT" 2> /dev/null || true
settings="${CZ_HOME:-$HOME/.cz}/userdata/settings.json"
mkdir -p "$(dirname "$settings")"
[ -s "$settings" ] || echo '{}' > "$settings"
jq '
  .providerInstances.codex //= {driver: "codex", enabled: true, config: {binaryPath: "codex", homePath: "", shadowHomePath: "", launchArgs: "", customModels: []}}
  | .providerInstances.codex.config.setupMode = "existing"
  | .defaultModelSelection //= {instanceId: "claudeAgent", model: "claude-opus-5-5", options: [{id: "effort", value: "high"}]}
' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
systemctl --user restart "$UNIT"

if $in_wsl; then
  step "Keep WSL running after you log in to Windows"
  # WSL stops when nothing runs in it. A hidden startup script keeps an idle
  # process alive, so the cz service keeps answering. No admin rights needed.
  appdata=$(cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c 'echo %APPDATA%' | tr -d '\r')
  startup="$(wslpath "$appdata")/Microsoft/Windows/Start Menu/Programs/Startup"
  printf 'CreateObject("WScript.Shell").Run "wsl.exe -d %s --exec /bin/sleep infinity", 0, False\r\n' \
    "$WSL_DISTRO_NAME" > "$startup/cz-wsl-keepalive.vbs"
  (cd /mnt/c && /mnt/c/Windows/System32/wscript.exe "$(wslpath -w "$startup/cz-wsl-keepalive.vbs")")
  echo "Added $startup/cz-wsl-keepalive.vbs"

  step "Never sleep while plugged in"
  # A sleeping PC drops its agents mid-turn. The screen can still turn off.
  for setting in standby-timeout-ac hibernate-timeout-ac; do
    (cd /mnt/c && /mnt/c/Windows/System32/powercfg.exe /change "$setting" 0)
  done
  echo "Sleep and hibernate are off on AC power."
elif [ "$sleep_minutes" -gt 0 ]; then
  step "Sleep when idle, wake over the network"
  connection=$(nmcli -t -f NAME,DEVICE connection show --active |
    awk -F: -v device="$wired" '$2 == device {print $1; exit}')
  sudo nmcli connection modify "$connection" 802-3-ethernet.wake-on-lan magic
  sudo ethtool -s "$wired" wol g
  # cz decides when to sleep. A held sleep lock stops GNOME and the login
  # screen from suspending on their own; cz's helper overrides it.
  sudo systemctl unmask sleep.target suspend.target > /dev/null 2>&1
  sudo systemctl mask hibernate.target hybrid-sleep.target > /dev/null 2>&1
  sudo tee /etc/systemd/system/cz-host-sleep-lock.service > /dev/null << 'LOCK'
[Unit]
Description=Only cz puts this agent host to sleep (ccez/hosts/linux.sh)

[Service]
ExecStart=/usr/bin/systemd-inhibit --what=sleep --mode=block --who=cz-host --why="cz sleeps this host when idle" /bin/sleep infinity
Restart=always

[Install]
WantedBy=multi-user.target
LOCK
  sudo systemctl daemon-reload
  sudo systemctl enable --now cz-host-sleep-lock.service > /dev/null 2>&1
  sudo tee /usr/local/sbin/cz-host-sleep > /dev/null << 'HELPER'
#!/bin/sh
# Installed by ccez/hosts/linux.sh. cz's idle sleep runs this through sudo:
#   cz-host-sleep <wake-at-epoch-seconds, or 0 for no alarm>
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
wake_at=${1:-0}
case "$wake_at" in '' | *[!0-9]*) echo "usage: cz-host-sleep <epoch-seconds|0>" >&2 && exit 2 ;; esac
if [ "$wake_at" -gt 0 ]; then
  rtcwake -m no -t "$wake_at" > /dev/null
else
  rtcwake -m disable > /dev/null 2>&1 || true
fi
exec systemctl suspend --check-inhibitors=no
HELPER
  sudo chmod 755 /usr/local/sbin/cz-host-sleep
  echo "$USER ALL=(root) NOPASSWD: /usr/local/sbin/cz-host-sleep" |
    sudo tee /etc/sudoers.d/cz-host-sleep > /dev/null
  sudo chmod 440 /etc/sudoers.d/cz-host-sleep
  sudo visudo -cf /etc/sudoers.d/cz-host-sleep > /dev/null
  echo "Sleeps after $sleep_minutes idle minutes; the Mac wakes it over Ethernet when needed."
else
  step "Never sleep"
  # Ubuntu Desktop suspends when idle, which drops agents mid-turn. The screen can still turn off.
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target > /dev/null 2>&1
  echo "Sleep and hibernate are off."
fi

step "Coding agents"
npm_global() { have "$1" || npm install -g "$2"; }
npm_global claude @anthropic-ai/claude-code
npm_global codex @openai/codex
# OpenCode 2 is the npm package; opencode.ai/install still gives 1.x.
opencode --version 2> /dev/null | grep -q '^v\?2\.' || npm install -g @opencode/cli > /dev/null

step "Sign in: Claude"
if [ -s "$HOME/.claude/.credentials.json" ]; then
  echo "Already signed in."
else
  # Finish in this PC's browser: Claude shows a code to paste back here.
  claude auth login
fi

step "Sign in: Codex"
if codex login status > /dev/null 2>&1; then
  echo "Already signed in."
else
  echo "If OpenAI says device codes are off: in ChatGPT's settings, turn on"
  echo "\"Enable device code sign-in for Codex\", then run this script again."
  codex login --device-auth
fi

step "Sign in: OpenCode"
if [ -s "$HOME/.local/share/opencode/auth.json" ]; then
  echo "Already signed in."
else
  echo "No OpenCode login here yet. Usually the Mac copies its login (your Muse key)"
  echo "over Tailscale after this script finishes, so you can answer N."
  read -r -p "Sign in to OpenCode by hand instead? [y/N] " answer < /dev/tty
  case "$answer" in [yY]*) opencode auth login ;; *) ;; esac
fi
# czcode offers the reasoning variants OpenCode's config defines; Muse Spark's
# "max" exists only through this, as on the Mac.
if [ ! -e "$HOME/.config/opencode/opencode.jsonc" ] && [ ! -e "$HOME/.config/opencode/opencode.json" ]; then
  mkdir -p "$HOME/.config/opencode"
  cat > "$HOME/.config/opencode/opencode.jsonc" << 'EOF'
// Global OpenCode config for this agent host (from ccez/hosts/linux.sh).
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "meta": {
      "models": {
        "muse-spark-1.3-contributor": { "variants": { "max": { "reasoningEffort": "max" } } }
      }
    },
    "opencode": {
      "models": {
        "muse-spark-1.3-contributor-free": { "variants": { "max": { "reasoningEffort": "max" } } }
      }
    }
  }
}
EOF
fi

step "GitHub (so agents here can push)"
git config --global user.name > /dev/null || git config --global user.name "Chris Straka"
git config --global user.email > /dev/null || git config --global user.email "c@z.local"
if ! gh auth status > /dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git

step "Pair your phone and desktop"
systemctl --user --no-pager --lines=0 status "$UNIT" | head -3
cz pair --tailscale || echo "Pairing failed; check: journalctl --user -u $UNIT"
cat << DONE

Done. This host is $tailscale_name.
Hardware: $(nproc) cores, $(free -g | awk '/^Mem:/ {print $2}') GB memory, $(df -h --output=avail "$HOME" | tail -1 | tr -d ' ') free disk.
GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2> /dev/null || lspci 2> /dev/null | sed -n 's/.*\(VGA\|3D\) [^:]*: //p' | head -1 || echo "none found")
- Open the pairing link above on each device that should use this host.
- Copy ~/SWE/AGENTS.md from the Mac to the same path here, and clone your
  projects under ~/SWE with the same git origins.
- To update cz later, run this script again.
DONE
