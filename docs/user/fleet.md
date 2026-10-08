# Fleet

**Fleet** shows every machine you've paired at once and keeps it live: whether each is awake,
asleep, or unreachable, its CPU, memory, swap (with what zram costs in RAM), and free space on
each disk, and the agents working there right now with what each is doing and for how long.
Totals for the whole fleet sit at the top.

Open it from the machine menu at the left of the feed's top bar (**Machines**) or the command
palette (**Open fleet**) on web and desktop, the
server-rack button on the phone's thread list, or tab 5 in the terminal app (`cz tui`).

- A machine that is low on disk (under 10% free, or under 10 GB on a large disk), memory, or swap
  is outlined in red with what's running out.
- **Asleep** means the machine isn't answering but has an address another connected machine can
  send a wake packet to, as a host that sleeps when idle does. **Wake** sends it; the machine
  reconnects in about 30 seconds. **Unreachable** machines have nothing that can wake them.
- Readings of a machine that stopped answering stay on its card, greyed, with their age.
- Open an agent's thread from its row, or stop it there.

Readings refresh every few seconds while Fleet is open and the app is in front.

The machine menu shows a small load meter beside each machine: bars for CPU, memory, swap, and
the fullest disk, then how many agents are running. Hover it for the numbers. The machine the feed
shows carries the same meter in the top bar.
