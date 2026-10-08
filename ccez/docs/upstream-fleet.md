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

|                      | Theo                         | Us (`ccez/hosts`)                                                                                              |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Setting up a machine | Fleet doc + an agent         | `linux.sh` / `mac.sh` scripts (an agent can run them)                                                          |
| Machine inventory    | In the fleet repo            | [`ccez/hosts/FLEET.md`](../hosts/FLEET.md): machines and an agent runbook for a new box                        |
| Networking           | Tailscale (+ T3 Connect)     | Tailscale only (Connect removed)                                                                               |
| Projects             | Repos, grouped by git origin | Every repo in `repos.txt` is a cz project on every host (the sync job)                                         |
| Parallel work        | Linux boxes; Macs 1-2 tasks  | Linux hosts; the Mac stays free by day                                                                         |
| Agent filesystem     | Separate XFS + VDO drive     | Planned on art's `/data` (FLEET.md); OS drive, ext4 today                                                      |
| Extra we need        |                              | Sleep/Wake-on-LAN, per-agent memory scopes, repo sync, health checks, backups: our machines are mixed home PCs |

Open follow-ups live with the hosts work (`ccez/hosts/README.md`).
