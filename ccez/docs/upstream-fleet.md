# How Theo runs his machines, and how our hosts compare

Upstream T3 Code exists to run many coding agents in parallel across
machines. This note records how its author runs his own fleet, from his
videos, so agents working on `ccez/hosts` copy what he does instead of
guessing. Transcripts are in
`~/SWE/yt/third-party-channels/theo-t3gg/videos/<date>_<id>/`; timestamps
below link into the videos. Re-check the source before relying on a detail,
and add newer videos here when he describes his setup again.

## What he does

**A fleet repo on a manager machine.** One repo, kept on one machine that runs
nothing else, describes every computer he works on and includes "how to set up
a box": the tools he wants everywhere (ripgrep, fd, jq, tmux, btop, Node,
Python, build tools, Codex and Claude Code). For a new machine he sets up SSH,
opens that repo in an agent ("here's a new box, here's the SSH key, set it up
the way I like"), and approves the Tailscale join when the agent asks.
([23:19](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=1399s),
[24:05](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=1445s))

**Tailscale between everything.** Services on his tailnet stay private to it,
so they can skip extra auth.
([22:09](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=1329s))

**Projects are repos, grouped across machines by git origin.** In T3 Code, the
same repo on different machines shows as one project, and he picks the machine
per thread: usually one of three Linux boxes, a Mac only for mobile or
computer-use work. He uses T3 Connect for some machines.
([42:16](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=2536s),
[42:31](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=2551s),
[42:53](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=2573s))

**Linux boxes do the parallel work; Macs do one or two things.** An old or
modest Linux box with all his codebases and a T3 Code server takes effectively
unlimited parallel agents; macOS does not parallelize agent work well.
([5:22](https://www.youtube.com/watch?v=q1D90-uGvBg&t=322s),
[14:54](https://www.youtube.com/watch?v=q1D90-uGvBg&t=894s))

**Agent work lives on a separate fast drive.** APFS is slow for agent work
(installs, worktrees, node_modules); he moved agent work to a separate drive
formatted XFS on VDO (deduplication and compression), saving about 44% of the
space, after logs filled his OS drive.
([14:40](https://www.youtube.com/watch?v=4wVNFaFDIn8&t=880s),
[17:09](https://www.youtube.com/watch?v=4wVNFaFDIn8&t=1029s),
[24:14](https://www.youtube.com/watch?v=4wVNFaFDIn8&t=1454s),
[27:57](https://www.youtube.com/watch?v=4wVNFaFDIn8&t=1677s))

**Repos are set up for many agents at once.** The T3 Code repo has examples of
preparing a project for multi-agent, multi-worktree work (setup scripts per
worktree). ([6:24](https://www.youtube.com/watch?v=q1D90-uGvBg&t=384s))

**Not for us: one proxy for many accounts.** He routes five Claude and four
Codex accounts through a CLI proxy on one home machine so providers can't tell
the traffic comes from servers, and warns that using an account from many
computers at once is what gets flagged.
([14:16](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=856s),
[24:32](https://www.youtube.com/watch?v=D8PikZ1KhUo&t=1472s))
Pooling accounts and hiding server use is against the providers' terms; don't
build it. The warning itself matters to us: our hosts each sign in to the
owner's one Claude account and run agents at the same time.

## How our hosts compare

|                      | Theo                         | Us (`ccez/hosts`)                                                                       |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Setting up a machine | Fleet doc + an agent         | `linux.sh` / `mac.sh` scripts (an agent can run them)                                   |
| Machine inventory    | In the fleet repo            | [`ccez/hosts/FLEET.md`](../hosts/FLEET.md): machines and an agent runbook for a new box |
| Networking           | Tailscale (+ T3 Connect)     | Tailscale only (Connect removed)                                                        |
| Projects             | Repos, grouped by git origin | Every repo in `repos.txt` is a cz project on every host (the sync job)                  |
| Parallel work        | Linux boxes; Macs 1-2 tasks  | Linux hosts; the Mac stays free by day                                                  |
| Agent filesystem     | Separate XFS + VDO drive     | Planned on art's `/data` (FLEET.md); OS drive, ext4 today                               |
| Extra we need        |                              | See [What we run that upstream doesn't](#what-we-run-that-upstream-doesnt)              |

**He reviews and merges his own PRs.** He has an agent sort his open PRs by
how easy they are to merge, then squash-merges them himself in T3 Code.
([16:39](https://www.youtube.com/watch?v=q1D90-uGvBg&t=999s),
[18:19](https://www.youtube.com/watch?v=q1D90-uGvBg&t=1099s))
He reaches machines over Tailscale or `npx t3 connect` (T3 Connect).
([26:10](https://www.youtube.com/watch?v=dLhcLqoff6k&t=1570s))
His videos from 2026-10-05 to 2026-10-07 don't describe his setup.

## What we run that upstream doesn't

Audited 2026-10-07. Being on a tailnet isn't the difference: Theo is on
Tailscale too, and Tailscale Serve support is upstream's (#2361). Upstream
also polls, inside the server: PR sync, PR watch and thread settlement run
every minute (`PullRequestSyncReactor`, `ThreadSettlementService`). What
upstream doesn't have is the machinery around the server, and each piece
answers something specific to us: hosts that are home PCs nobody watches, a
NIC that hangs, small RAM, and an owner who never reviews PRs.

| What (how often)                                             | Why we have it                                                                                                                                      | Theo / upstream instead                                     | Verdict                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Network watchdog (every minute, root)                        | 2026-10-07: after a router restart, the Killer (alx) chips in f and art passed no traffic for an hour until reset by hand. basement recovered alone | Not described; his boxes are dedicated servers              | **Simplified**: alx hosts only (f, art). Rerunning `tune-host-linux.sh` removes it from basement                            |
| `pr-automerge` (every 10 minutes, f)                         | The owner never reviews or approves PRs (AGENTS.md); about 120 repos with Dependabot                                                                | Reviews and squash-merges his own PRs                       | **Keep**. Possible replacement: GitHub's own auto-merge (`gh pr merge --auto`), which needs a setting changed on every repo |
| `health` (nightly)                                           | Nobody watches the hosts; a dying drive's errors once filled 106 GB of `/var/log`; f's `/home` is 87% full                                          | Watches his machines himself                                | **Keep**                                                                                                                    |
| `backup` (nightly)                                           | `~/.cz/userdata` (threads, Decisions, secrets) lives on old home drives, one of them a hard drive                                                   | Not described                                               | **Keep**                                                                                                                    |
| `sync` (nightly)                                             | Any thread can run on any host, so every host has all 121 repos as cz projects                                                                      | An agent sets up each box from his fleet repo               | **Keep**                                                                                                                    |
| `update` (nightly)                                           | Hosts run a build of `main`, not a release, and restart only when no agent is working                                                               | Releases and `npx t3`                                       | **Keep**                                                                                                                    |
| Sleep when idle (checks every minute) + 03:30 wake           | Home PCs idle at about 100 W                                                                                                                        | Always-on boxes                                             | **Owner's call**. In its first 3 days it slept once (art); logged-in sessions and load kept f and basement up               |
| Host wake (asks every tailnet peer every 5 minutes)          | Wakes a sleeping host over Wake-on-LAN; needed only with sleep when idle                                                                            | Always on, plus T3 Connect                                  | **Goes with sleep when idle**                                                                                               |
| Agent scopes (every 5 seconds, Linux)                        | Hosts have 15-32 GB; systemd-oomd ended `cz-host` and every thread with it                                                                          | Not described                                               | **Keep**                                                                                                                    |
| Decisions (expiry check every 30 seconds)                    | The owner answers judgment calls from a phone, with images and options; replaced the separate inbox app                                             | Answers agents in the thread                                | **Keep**                                                                                                                    |
| Reset queue (checks every 30 seconds)                        | Runs work when a quota resets; replaced nightshift. One account per provider                                                                        | Several accounts per provider, so he rarely waits on resets | **Keep**                                                                                                                    |
| `cz tui`                                                     | The owner works in neovim                                                                                                                           | None                                                        | **Keep** (runs only when opened)                                                                                            |
| Mac: `caffeinate` while cz runs                              | A shared Mac must not sleep under an agent                                                                                                          | Macs do one or two things                                   | **Keep**                                                                                                                    |
| Pre-host-jobs `pr-automerge.timer` cleanup in `host-jobs.sh` | Migrated an older install                                                                                                                           |                                                             | **Cut**: no host has the old timer                                                                                          |

The 30-second and 5-second loops are in-process and cheap; making them wait
for the next due time instead would add code for no visible gain.

Open follow-ups live with the hosts work (`ccez/hosts/README.md`).
