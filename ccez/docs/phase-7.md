# P7: The terminal app (`cz tui`, `ct`)

A terminal client of the same cz servers the desktop app and phone use,
sized for the owner's neovim toggleterm float. `ct` in a project's folder
opens it scoped to that project.

## Built

- **`apps/tui`:** Ink (React for terminals) on client-runtime, the same
  connection, atoms, and commands web and mobile use. `cz tui` mints a
  session on this machine's server (revoked on exit) and also connects to
  every host the TUI has paired with. Saved pairings live in
  `~/.config/czcode/tui/connections.json` (mode 600).
- **Tabs:** 1 Threads, 2 Decisions, 3 Queue, 4 Hosts. Esc always goes back.
  Keys stay off `\`, `|`, and Cmd chords (the owner's float bindings).
  Every screen fits a 60-column float.
- **Scope:** the list opens on the project containing the cwd, matched by
  path, then by git origin, so the same repository's threads on other hosts
  show too. `a` toggles all projects. With no match, everything shows.
- **Threads:** a list across hosts (newest first, pinned on top, state:
  working, needs you, failed, plan ready).
  - **`n`:** new thread. Choose a host (skipped when there's one), a
    project (starts on the scoped one), and a model (↑↓). Tab switches
    between a worktree and the project folder (default from the project,
    then the host setting). ctrl+r queues it for the next reset instead.
  - **In a thread:** a live transcript, `i` reply, `y`/`a`/`n` approvals,
    digits answer a one-question prompt, `s` stop, `m` access mode, and `d`
    the thread's full diff (`]`/`[` jump files).
  - **`o`:** on a thread on another host, opens `tailscale ssh <host>` into
    its worktree in a new toggleterm float (through the parent nvim's
    `$NVIM` socket).
- **Decisions:** one feed from every host, in the shared order (blocking
  first), following the scope. Every kind answers from the keyboard on
  client-runtime's shared draft rules:
  - **pick** space · **rank** J/K · **review/look/read/pitch** digit verdicts
  - **listen:** space plays (mpv), y/x/f keep/kill/favourite, L loop, m more
  - **look:** ←→ turn a pre-rendered f3d turntable (12 frames), C clay,
    `o` opens f3d for free orbit
  - **read:** `p` comments on a paragraph (sent as a passage comment)
  - **playtest:** `i` installs the APK with adb, g/b/u fill the form
  - **timeline:** `a` approve, `r` redo from the selected step
  - **request:** `c` writes the answer. Any kind: `c` note, N "none of these".
- **Images inline** use the Kitty graphics protocol with Unicode
  placeholders: one transmit, then ordinary text cells coloured with the
  image id, so images move and clip with the float. Off inside tmux, which
  would need passthrough. `CZ_TUI_IMAGES=1|0` forces it.
- **Queue:** usage limits per host and provider, and runs waiting for a
  reset, with `r` run now and `x` cancel.
- **Hosts:** paired machines and their state (online, connecting,
  retrying, blocked: why). `p` pairs from a `cz pair --tailscale` link,
  `r` retries, `e` enables or disables a host.
- **Owner's setup:**
  - `~/.config/nvim/lua/config/kitty_passthrough.lua`, loaded from
    `config/autocmds.lua`, forwards a terminal job's Kitty graphics
    commands (`TermRequest` → `nvim_ui_send`). Its test is
    `tests/kitty_passthrough.lua`.
  - `alias ct="cz tui"` sits next to `cc` in `~/config/zsh/.zshrc`.

## Gate results

**Framework (measured, 100×40 pty, 2,000 streamed transcript updates into
a 38-row viewport):**

|                                   | spawn → first text | per update | bytes written |
| --------------------------------- | ------------------ | ---------- | ------------- |
| Ink on Node 25                    | 478 ms             | 2.8 ms     | 491 kB        |
| Ink on the app's Electron Node 24 | 538 ms             | 1.3 ms     | 283 kB        |
| OpenTUI on Bun                    | 647 ms             | 0.9 ms     | 119 kB        |

OpenTUI's native core doesn't load on Node 24 ("native FFI is not
available for this runtime yet"), which is the runtime the installed `cz`
uses. Shipping it would mean bundling Bun. Ink runs where `cz` already
runs, so Ink it is.

**Neovim passthrough** (nvim 0.12.5):

- A `:terminal` job's Kitty transmit fires `TermRequest` once with the
  full APC (134 bytes, ST terminator).
- In a real pty, the hook forwards it to nvim's output, and the
  placeholder cells keep their 24-bit id colour.
- The owner's smoke test still passes, and the full config registers the
  hook once.

**Against a sandbox server** (a read-only snapshot of real data, OpenCode
free model), text captures in `img/p7-*.txt`:

- **Connect and list:** local server listed, threads from the snapshot,
  scope from a folder (launchkit only; `a` showed all).
- **Threads:**
  - A new thread answered, and a reply answered.
  - In approval-required mode, a command waited for `y`, then ran.
  - A worktree thread wrote a file, and `d` showed its diff.
- **Decisions:** one of each seeded kind was answered and read back with
  `cz inbox get`: pick (image), blocking pick, rank, review + note, request
  (text), listen (keep/kill/favourite + more), look (turntable 0/30/60°,
  clay at 60°, then approve), read (a paragraph comment with its exact
  range), playtest (form), pitch.
- **Queue:** a task queued with ctrl+r became a thread within one poll and
  answered.
- **Images:** in a pty with images on, the pick wrote one transmit (`U=1`,
  48×16 cells) and 768 placeholder cells in that image's id colour.
- **Bundle:** `vp pack` built the server, and `dist/bin.mjs tui` ran.
- **Tests:** scope, transcript, drafts, Kitty encoding, and the nvim
  bridge, run against a real headless nvim (15 tests in apps/tui, plus the 6-check nvim hook test).

## Needs the owner's eyes

- **Images on screen in Ghostty, inside a `ct` float.** The bytes are
  right on both sides, but only a real Ghostty shows whether it draws them
  (and whether image.nvim's own images coexist).
- **How the 3D turntable feels:** 12 frames at 30°, ←→ to turn, `C`
  clay, `o` for f3d.
- **`o` on a remote host's thread:** it needs a second host with Tailscale
  SSH on. Only the command and the float opening were tested.

## Not done

- **Timeline answers weren't tried live:** `cz inbox submit` can't create
  steps. The keys are built, and the rules are shared.
- **Usage limits weren't tried live:** the sandbox's only provider (OpenCode
  free) reports none.
- **The nvim and zsh edits are uncommitted** in their own dotfile repos.
  This worktree agent can't run git outside czcode.
