# Set up a computer as a cz agent host

Every machine, its role, and an agent's runbook for setting up a new one:
[FLEET.md](FLEET.md).

How upstream's author runs his own fleet, and how this setup compares:
[../docs/upstream-fleet.md](../docs/upstream-fleet.md). Read it before changing
how hosts work.

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

Each Linux host runs these jobs every night, `sweep` weekly (`host-jobs.sh`
installs them as systemd user timers named `cz-job-<name>`):

| Time      | Job      | What it does                                               |
| --------- | -------- | ---------------------------------------------------------- |
| 03:30     | `health` | Disk space, SMART, logs, failed units, memory, other hosts |
| 03:35     | `backup` | Copies `~/.cz/userdata` to another host, 7 days kept       |
| 03:45     | `sync`   | Clones and fast-forwards the repos in `repos.txt`          |
| 03:50     | `drive`  | Moves model caches and media to a second drive, when idle  |
| Sun 03:55 | `sweep`  | Deletes build output untouched for 7 days                  |
| 04:00     | `update` | Builds the latest cz, restarts into it when idle           |

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

- **health:** reports a disk over 80% full (time to act before 85%), SMART warnings or kernel disk
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
- **drive:** on a host with a second drive at `/data`, moves model caches
  (Hugging Face, torch, Whisper, gk-stylize), mediaforge's store, big
  `.venv`s and the Android SDK there, leaving symlinks so paths don't
  change. A folder moves only when nothing is using it. See
  [FLEET.md](FLEET.md#agent-work-drive).
- **sweep:** the hosts keep as little as they can; the repos are the record.
  It deletes Rust `target` and Gradle build folders untouched for 7 days,
  `node_modules` of repos idle for a week (not the czcode checkout), and
  finished worktrees (clean, pushed, untouched for a day, no thread using
  them). ccez-llm is never touched, and nothing in use is: a build running
  in the repo, or a running thread's project. `--days 0` clears everything
  idle now.
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

The Macs aren't part of the host jobs (they're systemd timers). `z` has no
SSH server for the others to reach, so `health` and `fleet-status.sh` only
check that it's online; `y8` answers over Tailscale SSH and shows no jobs.

### Recurring jobs agents add

czcode's Schedules view (the clock in the top bar) lists every recurring job
on a host: the host jobs above, cz's own scheduled tasks, and any timer an
agent installs. An agent that installs a systemd timer (or a launchd job on
the Mac) registers it in the same step:

```sh
cz jobs add --unit feeds-watch.timer --description "Pull public data for launchkit and mediaforge" \
  --project scrapers --output ~/data/feeds
```

That adds a `[[job]]` to `~/.config/cz-host/jobs.toml`, which `host-jobs.sh`
keeps when it rewrites its own entries. The view reads the schedule, next
run and runs from systemd. Run the job's command through `job-run.sh <name>`
(exit 0 ok, 2 needs the owner, anything else failed; the last line of output
is the summary) and the view shows that summary too. `cz jobs list` shows the
same as the view: registered jobs plus timers whose unit files were written on
the machine (under `/etc` or `~/.config`). `--all` adds the OS's and packages'
timers (unit files under `/usr` or `/lib`, and snap's), which the view hides
under **Show system timers**. `cz jobs remove <name>` unregisters a job and
leaves its timer alone.

## Where heavy work goes

Before starting a long build, render or test run, agents ask which host has
room:

```sh
bash ~/SWE/czcode/ccez/hosts/pick-host.sh cpu        # or gpu, emulator; --list explains
```

It prints the least loaded Linux host with the hardware the work needs (the
fourth column of `hosts.txt`), for example `basement b@basement`, waking it
if it's asleep. `art-ms-7917` (RTX 2060 SUPER) is the only `gpu` and
`emulator` host: Blender GPU renders, Whisper, local models, shader work and
fast Android testing go there. CPU work goes wherever the load is lowest;
`f-ms-7917` has the most threads (8) when it isn't busy.

## Android emulator

Android testing happens on emulators only; the phone is the owner's. Every
Linux host has one AVD, `cz`, set up by the build tools:

```sh
serial=$(bash ~/SWE/czcode/ccez/hosts/android-emulator.sh start)   # e.g. emulator-5554
adb -s "$serial" install app.apk
bash ~/SWE/czcode/ccez/hosts/android-emulator.sh stop
```

It starts from a saved snapshot in under 10 seconds and is shared by the
agents on that host. On `art-ms-7917` it has 4 cores, 4 GB and renders on
the GPU, so frame rates there are realistic; that needs a desktop session on
art (automatic login, in [FLEET.md](FLEET.md)), and without one it renders in software like the others. On
`f-ms-7917` and `basement` it has 2 cores, 3 GB and a software GPU: right
for checking that things work, not for judging smoothness.

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
- **MacBooks with the lid closed:** on power, a MacBook keeps running with its
  lid closed (`lid-awake-mac.sh`, a root launchd daemon). Unplugged, it's a
  normal laptop: it sleeps when the lid closes, and if it was unplugged while
  closed it sleeps at once, so it doesn't stay awake in a bag. Check it with
  `bash ~/SWE/czcode/ccez/hosts/lid-awake-mac.sh status`; remove it with
  `sudo bash ~/SWE/czcode/ccez/hosts/lid-awake-mac.sh uninstall`.
  `CZ_HOST_LID_AWAKE=0` before `mac.sh` skips it.
- **After a restart:** cz runs while the agent account is logged in. Log in
  to it once, then switch back to another account from the menu bar (fast
  user switching); cz keeps running in the background.
- **Status and logs:** `launchctl print gui/$(id -u)/uk.ccez.cz-host` and
  `~/Library/Logs/cz-host.log`.

To add or update the build tools on a Mac that's already set up, run
`bash ~/SWE/czcode/ccez/hosts/build-tools-mac.sh` (no password needed).
`CZ_TOOLS_SKIP` works as on Linux. To see every step without running
anything, put `CZ_HOST_DRY_RUN=1` before either script.
