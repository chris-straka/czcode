# Terminal app

`cz tui` opens czcode in a terminal, sized for a 60-column editor float as well as a full
window. It talks to the server on this machine and to every machine paired in its **Hosts** tab
(`p` pairs one from a `cz pair --tailscale` link), so threads you start here show up on the
phone and desktop, and back. Started inside a project folder, it shows that project's threads;
`a` switches to all projects.

Tabs: **1** Threads, **2** Decisions, **3** Queue, **4** Hosts, **5** [Fleet](./fleet.md). Each
screen lists its keys at the bottom. Vim keys work everywhere: `j`/`k`, `gg`/`G`,
`ctrl-d`/`ctrl-u`, `/` to search, and `q`, `h` or `esc` to go back (`q` quits from a tab).

## Threads

The list follows the desktop sidebar's shelves: pinned and active threads, then folded
**Snoozed** and **Settled** shelves (Enter unfolds one). `/` searches titles and messages. On the
selected thread: `s` settles, `p` pins, `z` snoozes or wakes, `x` archives, `R` renames, `D`
deletes, and `u` undoes the last of these. `v` shows the archive, where `x` restores.

In a thread, `i` writes a reply. While the agent is running, Enter queues the message after the
run and Tab switches to steering the run instead. `↑` recalls what you sent, `+` attaches an
image by path, and `ctrl+v` pastes the clipboard's image. `M` picks the model for the next
message, `e` steps its reasoning effort, `p` toggles plan mode, `I` implements a ready plan, and
`m` cycles access. `d` shows the latest turn's changes (`h`/`l` other turns, `a` all of them),
`v` expands tool output, `F` forks from the last finished turn, and `s` stops the run. Agent
questions are answered in place: digits pick options, `i` types your own answer.

## Decisions

The tab's count covers the decisions the current filter shows (`a` switches between this project
and all). In a decision, `1`-`9` pick an option (or a verdict), `]`/`[` move between options,
Enter sends, `c` adds a note, and `n`/`p` step to the next or previous decision. `j`/`k` scroll,
`o` opens the focused image full screen, and `t` opens the thread that asked.

Images (decision options, renders, screenshots, images attached to messages, and a poster
frame for videos) show inline in Ghostty and kitty, including inside a neovim float and over
SSH from those terminals. Elsewhere, such as an SSH app on a phone, they show as a name you can
open with `o`.

## Queue

Runs waiting for a provider's quota reset. `r` starts one now and `x` cancels it; a run that
failed to start is dismissed with `x`.
