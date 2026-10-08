# The fleet

Every machine the owner's agents use, what each one is for, and how an agent
takes a new machine from "SSH works" to fully set up. The scripts in this
folder do the setup; this page is the map. Machine roles also appear in
`~/SWE/FACTORY.md` §5, which points here for detail. How upstream's author
runs his fleet, and what we took from it: [upstream-fleet.md](../docs/upstream-fleet.md).

## Machines

All are on the owner's tailnet (`tailfe37c2.ts.net`); log in with Tailscale
SSH as `<user>@<name>`. `hosts.txt` is the machine-readable list the jobs and
`pick-host.sh` read.

- **`z`**: Mac mini M4, 16 GB. The owner's desk: Blender, iOS builds, playing
  Mac builds. Runs the czcode desktop app, which its own session rebuilds.
  One or two agent tasks at most, and none by day; no SSH server (Tailscale
  from the App Store), so nothing logs in to it.
- **`f-ms-7917`** (user `f`): i7-4790K, 8 threads, 32 GB, GTX 970. Ubuntu
  26.04; `/home` on a 480 GB SSD. The most CPU threads: long compiles,
  Docker, Bevy builds. Runs `pr-automerge`. Often the most loaded host.
- **`art-ms-7917`** (user `art`): i5-4670, 4 cores, 32 GB, RTX 2060 SUPER
  (8 GB, the newest CUDA card). Ubuntu 26.04 on a 224 GB SSD, plus `/data`, a
  1 TB Samsung T7 for agent work (see below). GPU work: the Android emulator
  at realistic frame rates, Blender GPU renders, Whisper, local models,
  shader work.
- **`basement`** (user `b`): AMD FX-6300, 6 slow cores, 15 GB, GTX 770 (too
  old for current CUDA). Ubuntu 26.04 on a 1 TB hard drive. Overflow CPU work
  and the backup host for `f` and `art`.

The Linux hosts run cz as a service (`cz-host`), take as many parallel agent
tasks as their memory allows, sleep after 30 idle minutes and wake over the
network when another cz server needs them, and wake at 03:30 for the
[host jobs](README.md#host-jobs). Each has every repo in `repos.txt`, each
registered as a cz project, so any thread can run on any host. Pick the host
for heavy work with `pick-host.sh` ([README](README.md#where-heavy-work-goes)).

Not hosts: the NAS (`Straka5alive`, bulk files only), the broken 1080 Ti PC,
and the owner's phone (theirs; Android testing uses emulators).

## Set up a new Linux machine

For an agent with SSH access to a fresh Ubuntu (or WSL) machine. Steps marked
**owner** need the owner at the machine or on a sign-in page; ask through
Decisions and keep going with the rest.

1. **owner:** Ubuntu installed, the machine signed in to the tailnet
   (`sudo tailscale up --ssh`, approve it in the Tailscale admin page), and
   an account whose password the owner knows.
2. Run the setup over SSH with a terminal, since it asks for the sudo
   password and walks through sign-ins (**owner** answers those):

   ```sh
   ssh -t <user>@<name> 'wget -qO /tmp/cz-host.sh https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh && bash /tmp/cz-host.sh'
   ```

   It installs the tools, builds cz into `~/.local/lib/cz-host/cz`, starts the
   `cz-host` service, installs the host jobs, and prints a pairing link.

3. Add the machine to `hosts.txt` (name, login, the host that keeps its
   backups, hardware tags) and commit. Give `f-ms-7917` or `basement` a backup
   host with room.
4. Copy the owner's rules: `scp ~/SWE/AGENTS.md <user>@<name>:SWE/AGENTS.md`.
5. Clone the repos now instead of tonight:
   `ssh <user>@<name> systemctl --user start --no-block cz-job-sync.service`.
6. Check it: `bash ~/SWE/czcode/ccez/hosts/fleet-status.sh` shows the host,
   and on the host `bash ~/SWE/czcode/ccez/hosts/health.sh` prints `healthy`
   (or what to fix). Add it to the list above.
7. **owner:** open the pairing link on the desktop and phone.

A Mac uses `mac.sh` instead ([README](README.md#a-mac)); it is for a
separate macOS account on a shared Mac and has no host jobs.

## One-time root steps still open

The jobs run without root. These need the owner (`sudo`) once:

- **art, GPU emulator:** the emulator renders on the GPU only through a
  desktop session. Log `art` in automatically at boot, then restart:
  `sudo sed -i '/^\[daemon\]/a AutomaticLoginEnable=true\nAutomaticLogin=art' /etc/gdm3/custom.conf && sudo reboot`
- **f, pnpm store:** a root-owned folder in the pnpm store makes `vp i` fail
  on f (and with it cz updates there):
  `sudo chown -R f:f /home/f/.local/share/pnpm/store/v11/projects /home/f/.npm`
- **every Linux host, logs:** `sudo bash ~/SWE/czcode/ccez/hosts/tune-host-linux.sh`
  turns off rsyslog's uncapped copies in `/var/log`.

## Agent work drive

Agent work (worktrees, `node_modules`, Rust `target` folders) is many small
files written and deleted all day, much of it duplicated. Upstream's author
keeps it on a separate drive formatted XFS on VDO (deduplication and
compression) and saved about 44% of the space. art's `/data` (the 1 TB T7,
empty, ext4) is meant for it.

Measured on art with `bash ~/SWE/czcode/ccez/hosts/disk-bench.sh <folder>`
(2026-10-07, load around 30 on 4 cores, both ext4):

- `pnpm install` from a warm store: 22 s on the T7, 23 s on the internal SSD.
- Clean `cargo build` of rfcheck (2 jobs): 13 s on the T7, 12 s internal.

So on art the disk isn't what's slow; its 4 cores are. The case for `/data`
is space: art's 224 GB system drive is 83% full. VDO's deduplication and
compression run on the CPU, which art has least of, so start with plain XFS
(its reflinks make copies of worktrees and build folders nearly free) and
add VDO only if space runs short. basement has no second drive; its one hard
drive is the slowest disk in the fleet, so an SSD there would help more than
any filesystem.

**owner**, to reformat `/data` as XFS (erases the T7; first check `lsblk`
shows it as `sdb`, model `PSSD T7`):

```sh
sudo umount /data && sudo wipefs -a /dev/sdb1
sudo mkfs.xfs -f -m reflink=1 -L agents /dev/sdb1
sudo sed -i '\#[[:space:]]/data[[:space:]]#d' /etc/fstab
echo 'LABEL=agents /data xfs defaults,noatime,nofail,x-systemd.device-timeout=30s 0 0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount /data && sudo chown art:art /data
```

With VDO instead (after `sudo apt-get install -y lvm2 vdo`): make the whole
disk an LVM volume group, `sudo lvcreate --type vdo -n work -l 100%FREE -V 2T
agents`, and `mkfs.xfs -K` on `/dev/agents/work`. Then point agent work at
it: the pnpm store (`pnpm config set store-dir /data/pnpm-store`), czcode
worktrees and Rust target folders, and rerun `disk-bench.sh /data` to
compare.

## Accounts

Each host signs in to the owner's own Claude, Codex and OpenCode accounts.
Never route several accounts through one proxy or disguise where traffic
comes from: it's against the providers' terms.
