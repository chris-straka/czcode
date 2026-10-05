#!/usr/bin/env bash
# WINDOWS, FIRST TIME ONLY: open PowerShell, run `wsl --install`, restart the
# PC, open "Ubuntu" from the Start menu, and pick a username and password.
#
# Then copy this line into the Ubuntu terminal (right-click pastes):
#
# curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh -o /tmp/cz-host.sh && bash /tmp/cz-host.sh
#
# Sets up this machine as a cz agent host: tools, Tailscale, cz built from this
# repo and kept running as a background service on the tailnet, and the Claude,
# Codex, and OpenCode logins (each prints a link or code to open on any
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

step "cz as a background service on the tailnet"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$UNIT" << UNITFILE
[Unit]
Description=cz agent host (ccez/hosts/linux.sh)
After=network-online.target

[Service]
Environment=CZ_TAILSCALE_SERVE=1
# systemd's default PATH lacks the agents installed in your home.
Environment=PATH=$HOME/.local/bin:$HOME/.opencode/bin:/usr/local/bin:/usr/bin:/bin
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
fi

step "Coding agents"
npm_global() { have "$1" || npm install -g "$2"; }
npm_global claude @anthropic-ai/claude-code
npm_global codex @openai/codex
have opencode || curl -fsSL https://opencode.ai/install | bash
export PATH="$HOME/.opencode/bin:$PATH"

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
  codex login --device-auth
fi

step "Sign in: OpenCode"
opencode auth list || true
echo "Skip this to have the Mac copy its OpenCode login (your Muse key) here over Tailscale."
read -r -p "Add an OpenCode login by hand now? [y/N] " answer < /dev/tty
case "$answer" in [yY]*) opencode auth login ;; *) ;; esac

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
- Open the pairing link above on each device that should use this host.
- Copy ~/SWE/AGENTS.md from the Mac to the same path here, and clone your
  projects under ~/SWE with the same git origins.
- To update cz later, run this script again.
DONE
