# Set up a computer as a cz agent host

Linux and Windows PCs use `linux.sh` (below). Macs use `mac.sh`
([A Mac](#a-mac)).

**Windows, first time only:** open PowerShell, run `wsl --install`, restart,
open **Ubuntu** from the Start menu, and pick a username and password.
**A PC running Ubuntu itself:** open Terminal.

Then paste this into the terminal (right-click pastes):

```sh
wget -qO /tmp/cz-host.sh https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh && bash /tmp/cz-host.sh
```

It installs Tailscale, cz, Claude Code, Codex, and OpenCode, and keeps cz
running in the background. It walks you through each sign-in, then prints a
pairing link to open in czcode on your other devices. It also sets up the
[host jobs](#host-jobs), so cz updates itself and the host keeps its repos,
backups and health in order. Run it again any time for new tools.

- **Claude:** sign in with this computer's browser. Claude shows a code to
  paste back into the terminal.
- **Codex (press Enter to sign in, or N to skip) and GitHub:** open the link on any device and enter the code. For
  Codex, first turn on "Enable device code sign-in for Codex" in ChatGPT's
  settings.
- **OpenCode:** skip it. The Mac copies its login here over Tailscale.

## Build tools

The script also installs everything the factory's projects build with: Rust,
Go, Java and Kotlin, the Android SDK and NDK, C/C++ toolchains, Python, Node
and bun, .NET, Docker, Kubernetes tools, Blender, ffmpeg and the libraries
Bevy games need. Set `CZ_HOST_TOOLS=0` before the command to skip them.

It also tunes the machine (`tune-host-linux.sh`): compressed swap in RAM
(zram), a disk swap file up to 16 GB, higher file-watcher limits, and caps on
log sizes. On PCs with a Killer (Atheros `alx`) network chip it installs
[alx-wol](https://github.com/chris-straka/alx-wol), so they can sleep and be
woken over the network too; restart and run the script again afterwards.
czcode starts with Codex using this machine's own sign-in and with
Claude Opus as the default model for new threads.

To add or update the tools on a host that's already set up, run:

```sh
bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh
```

From another machine, quote the path so `~` expands on the host:
`ssh -t b@basement 'bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh'`.
To leave groups out, set `CZ_TOOLS_SKIP`, for example
`CZ_TOOLS_SKIP="android blender"`.

## Host jobs

Each Linux host runs these jobs every night (`host-jobs.sh` installs them as
systemd user timers named `cz-job-<name>`):

| Time  | Job      | What it does                                               |
| ----- | -------- | ---------------------------------------------------------- |
| 03:30 | `health` | Disk space, SMART, logs, failed units, memory, other hosts |
| 03:35 | `backup` | Copies `~/.cz/userdata` to another host, 7 days kept       |
| 03:45 | `sync`   | Clones and fast-forwards the repos in `repos.txt`          |
| 04:00 | `update` | Builds the latest cz, restarts into it when idle           |

Hosts that sleep when idle wake at 03:30 for them and stay awake until they
finish. A job that was missed (the host was off) runs when it next wakes.

**See how they went** on every host at once, from any host:

```sh
bash ~/SWE/czcode/ccez/hosts/fleet-status.sh
```

Each line is a job's last run: `ok`, `attention` (it ran and found something
for you, listed in its summary) or `failed`. `--json` gives the same for
scripts such as the morning brief. On the host itself, the last run's output
is in `~/.local/state/cz-host/jobs/<name>.log`, every run is in
`history.jsonl` there, and the schedule is in `~/.config/cz-host/jobs.toml`.

**Run one now:** `systemctl --user start --no-block cz-job-<name>.service`.

- **health:** reports a disk over 85% full, SMART warnings or kernel disk
  errors, oversized logs, failed services (yours and agents', not the
  desktop's), timers whose program is missing, low memory, heavy swap or
  out-of-memory kills, cz not running, and hosts in `hosts.txt` that don't
  answer.
- **backup:** the host each one backs up to is the third column of
  `hosts.txt`. Backups are in `~/cz-backups/<host>/<date>` on that host,
  including cz's secrets, so keep that folder private. To restore, stop cz
  (`systemctl --user stop cz-host`), copy a day's folder over
  `~/.cz/userdata` on the host it came from, and start cz again.
- **sync:** clones repos that are missing, fetches all of them, and
  fast-forwards ones with no local changes. It never discards work: changes,
  unpushed or diverged commits, other branches, and repos that aren't in
  `repos.txt` (some exist on one machine only) are listed for you. A
  `pnpm-lock.yaml` that is the only change is `vp i` churn and is put back.
  Add a line to `repos.txt` for a repo every host should have.
- **update:** cz runs from a build in `~/.local/lib/cz-host/cz`, not from
  `~/SWE/czcode`, so agents' edits there never break it. The job builds the
  latest `main` next to the running build, then restarts cz only when no
  thread is working and no queued run or scheduled task is due within 10
  minutes, checking for up to 3 hours. If the new build doesn't start, it
  goes back to the old one. Update a host now (still waiting for idle):
  `systemctl --user start --no-block cz-job-update.service`.
- **pr-automerge** (one host, every 10 minutes): merges your green pull
  requests in all your repos, and asks Dependabot once to rebase a PR that
  has conflicts. Turn it on with `CZ_HOST_PR_AUTOMERGE=1` before `linux.sh`
  (or `host-jobs.sh`); `CZ_HOST_PR_AUTOMERGE=0` turns it off. It runs on
  `f-ms-7917`.

The Mac isn't part of the host jobs: it has no SSH server for the others to
reach, so `health` and `fleet-status.sh` only check that it's online.

## A Mac

`mac.sh` is made for a separate macOS account on a Mac someone else also
uses, such as a family member's Mac Studio. Everything goes in that account's
home folder except Homebrew and Tailscale, which the whole Mac shares. It
never touches other accounts. It stops and says why if this Mac already has
the Tailscale app or another account's Homebrew.

1. In **System Settings → Users & Groups**, add an account for the agents
   and make it an **Administrator** (only the first run needs that; switch it
   back to Standard afterwards if you like).
2. Log in to that account, open **Terminal**, and paste:

```sh
curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/mac.sh -o /tmp/cz-host.sh && bash /tmp/cz-host.sh
```

It installs Homebrew, Tailscale, cz, the build tools (`build-tools-mac.sh`;
set `CZ_HOST_TOOLS=0` before the command to skip them), Claude Code, Codex,
and OpenCode. cz runs as a launchd agent that restarts if it stops. Sign-ins
and the pairing link work as on Linux; Claude opens this Mac's browser.

- **Staying awake:** while cz runs and the Mac is on power, the Mac doesn't
  sleep (`caffeinate`). The display still sleeps and the screen can lock.
  There's no Wake-on-LAN.
- **After a restart:** cz runs while the agent account is logged in. Log in
  to it once, then switch back to another account from the menu bar (fast
  user switching); cz keeps running in the background.
- **Status and logs:** `launchctl print gui/$(id -u)/uk.ccez.cz-host` and
  `~/Library/Logs/cz-host.log`.

To add or update the build tools on a Mac that's already set up, run
`bash ~/SWE/czcode/ccez/hosts/build-tools-mac.sh` (no password needed).
`CZ_TOOLS_SKIP` works as on Linux. To see every step without running
anything, put `CZ_HOST_DRY_RUN=1` before either script.
