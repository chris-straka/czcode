# czcode: one app for agents and decisions (T3 Code fork + ccez-inbox + nightshift)

Decided by the owner 2026-10-04: one app for everything, named **czcode**
(CLI and server: `cz`). Agent
threads (from T3 Code) and decisions with media (from ccez-inbox) live in
the same app on the phone, the Mac desktop, and the browser. **Nothing named
T3 remains anywhere:** not the app, the CLI, the server, packages, config
folders, env vars, or hostnames. Nothing is routed through T3's hosted
services.

This folder (`ccez/`) holds everything fork-specific that isn't product code:
this plan, phase logs (`ccez/docs/phase-N.md`), brand sources, the rename
script, and the upstream sync log.

## What exists today

- **T3 Code** (this repo, `chris-straka/czcode` at `~/SWE/czcode`, renamed from
  `t3code` on 2026-10-04; fork of `pingdotgg/t3code`, MIT, TypeScript):
  Expo/React Native mobile app (`apps/mobile`), React + TanStack Router web
  app (`apps/web`), Electron desktop (`apps/desktop`), the `t3` server and CLI
  that run on each machine (`apps/server`, Node + Effect), the T3 Connect relay
  as a Cloudflare Worker (`infra/relay`: Clerk identity, managed tunnels,
  FCM/APNs push), and an Astro marketing site (`apps/marketing`). Mobile
  already ships `react-native-webview`, `expo-audio`, `expo-video`,
  `expo-notifications`, and gesture handling: everything the inbox views need.
- **ccez-inbox** (`~/SWE/ccez-inbox`, live at inbox.ccez.uk): Cloudflare
  Worker + D1 + R2 behind Cloudflare Access; vanilla-TS PWA (feed, item
  view, A/B compare, `<model-viewer>` GLB, audio/video, voice notes, Web Push,
  build install, pitch → task, digest, fleet panel); `inbox` CLI + MCP that
  agents, genforge, and nightshift already use.
- **nightshift** (`~/SWE/nightshift`, Bun, `ns` CLI + launchd daemon):
  reset-aware queue that starts queued tasks as threads when a provider's
  quota window resets.

## Target

- **One app, czcode.** Tabs: **Threads** (agent threads as T3 has them today),
  **Decisions** (judgment calls with media, designed in
  [DECISIONS.md](DECISIONS.md)), plus T3's existing Usage → Limits page
  (gains the reset queue) and **Settings**. No separate Fleet tab: T3 already
  has threads, quotas, reset countdowns, and load balancing. On Android (Expo), on the Mac (Electron desktop), and in any
  browser (web app).
- **CLI and server: `cz`.** `cz serve`, `cz pair`, `cz service install`,
  `cz update`; data in `~/.cz` (migrated from `~/.t3` on first run); env vars
  `CZ_*`; package scope `@cz/*`; schemes `czcode://` (`cz://` collides with
  shared upstream strings, see phase-0); bundle IDs `uk.ccez.cz`
  (`.dev`, `.preview`).
- **czcode is the inbox** (owner, 2026-10-04). Decisions live in the cz
  server on the host whose agent asked, next to its threads (SQLite in
  `~/.cz/userdata`, media files beside it). Agents ask through cz's MCP tools
  and a `cz inbox` CLI (`submit`, `wait`, `get`, `list`, `history`);
  callers of the old `inbox` CLI move to it (no alias). Devices see decisions
  from every paired host in one feed, using the pairing they already have:
  no Cloudflare Worker, Access, or extra tokens. The Worker, PWA, and
  inbox.ccez.uk are retired with nothing imported (owner, 2026-10-05: never
  used it, nothing worth keeping). The Darkroom branch is dropped; its
  interaction ideas are already in DECISIONS.md.
- **nightshift folds into the cz server** (owner, 2026-10-04): the reset
  queue becomes a server service that uses the quotas and reset times cz
  already tracks. `cz queue` replaces `ns`; callers (genforge, ccez-inbox's
  task sync) move to it, then `~/SWE/nightshift` is retired.
- **No hosted middleman:** devices reach machines over **Tailscale**; T3
  Connect's relay and Clerk sign-in are removed. **No push notifications for
  now** (the owner checks in on their own time); an optional later phase adds
  direct Firebase push. No analytics leave the owner's machines.
- **Home machines:** the M4 Mac mini stays awake as the main desktop; two
  Windows PCs are additional agent hosts when needed. Each host has Tailscale,
  czcode, its own projects, and the providers it will run installed and
  authenticated locally. Each client pairs once with each host it will use.
  Reuse upstream's optional web/desktop load balancing for new threads in
  projects grouped across connected machines, based on available CPU, memory,
  and machine preferences. Existing threads stay on their original host;
  mobile selects the host manually. Connect is not needed for balancing.
  Windows PCs can sleep when unused and must be awake with czcode running
  before receiving work. Wake-on-LAN from the Mac is optional setup requiring
  validation on both PCs; automatic wake/sleep and mobile load balancing are
  separate work, not assumed upstream capabilities.
- **Desktop: T3's Electron app, rebranded to cz** (owner's call,
  2026-10-04, after weighing Tauri). It keeps Chromium rendering, the
  built-in Node that runs the server, the web-preview browser and cookie
  import, and every upstream desktop improvement through the weekly sync.
  Only names, icons, IDs, and the update feed change.
- **No branding, anywhere (owner, 2026-10-04): a clean, invisible look.**
  No logo, wordmark, or app name inside the UI: not in the sidebar, header,
  splash, welcome wizard, empty states, About, or notifications. Splash is
  the plain background colour. The name "czcode" appears only where the OS
  requires one (launcher label, window title, bundle display name). The
  launcher icon is a plain, quiet mark (owner picks from 2-4 minimal options
  in P0), not a logo.
- **Themes:** keep T3's themes for now (owner isn't a fan); a cz theme of
  the owner's choosing comes later as its own phase.
- **Thread ↔ decision links both ways:** an inbox item opens its thread; a
  thread shows its open inbox items inline, answerable without leaving it.
- **A terminal app too, `cz tui` (owner, 2026-10-05):** the owner works in
  neovim most of the time, so cz gets a terminal client of the same server
  with the desktop app's features, opened by a `ct` shell alias in a
  toggleterm float the way `cc` opens Claude. One server, one state: a
  thread started in the float shows on the phone and desktop, and back.
  Fit with the owner's setup (Ghostty, nvim 0.12, `~/.config/nvim`):
  - Images use the Kitty graphics protocol with Unicode placeholders, so
    they move and clip with the float. Inside nvim, a small hook in the
    owner's config forwards the image data to Ghostty (`TermRequest` →
    `nvim_ui_send()`); plain Ghostty needs nothing.
  - Keys stay off `\` and `|` (the owner's float toggle and exit to
    Terminal-Normal) and Cmd chords. Esc belongs to the TUI. Mouse works.
    Layouts work down to the float's 60-column minimum.
  - 3D, audio, video, and APKs reuse what the owner's nvim already uses:
    f3d, mpv, adb.
  - Built on `packages/client-runtime`, like web and mobile. The framework
    (Ink or OpenTUI) is picked by measurement at the start of the phase.

## The rename is a script, not hand edits

`ccez/rename/` holds a deterministic codemod (a mapping table plus a script)
that rewrites every T3 name: package scope, imports, CLI and binary names,
config paths, env vars, user-visible strings, URL schemes, bundle IDs,
hostnames, file and folder names, and docs. It runs over upstream code before
it's merged:

- Branch `upstream-cz` = the codemod applied to `upstream/main`, regenerated
  on every sync. Because the script is deterministic, each regenerated
  snapshot differs from the last one only by upstream's own changes, already
  renamed.
- `main` merges `upstream-cz`, so upstream updates arrive pre-renamed and
  merge like normal commits. Fork features are written directly with cz
  names.
- A check (`ccez/rename/check`) fails the build if any T3 name appears
  outside the allowlist (LICENSE/NOTICE copyright lines, the upstream remote
  URL, this plan).

## Phases and gates

| Phase                                       | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gate (numbers + screenshots in `ccez/docs/phase-N.md`)                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 Name + icon                              | App name **czcode** (decided). Owner picks a launcher icon from 2-4 minimal, unbranded options (plain shapes or a single glyph, no letters or logo), sent via the inbox. Sources in `ccez/brand/`; one config module for app name, scheme, bundle IDs, hostnames, update feed                                                                                                                                                                                                                                                                                                                                      | Owner's pick recorded                                                                                                                                                                                                                                                                                                                                                                                         |
| P1 Rename                                   | The codemod in `ccez/rename/` + `upstream-cz` branch flow; run it on `main`: packages `@cz/*`, CLI/server `cz`, `~/.cz` with migration from `~/.t3`, `CZ_*` env vars (old names read as fallback once, with a warning), icons, splash, favicons, notification and adaptive icons, iOS Icon Composer projects, bundle IDs, schemes, deep links; Electron desktop renamed (app name, icons, bundle ID, `cz://` deep links, updater pointed at the owner's GitHub releases); remove `apps/marketing`; **PostHog analytics removed**; README rewritten.                                                                | `ccez/rename/check` passes (zero T3 names outside the allowlist); typecheck + tests + mobile static check pass; `cz serve` runs on the Mac and keeps existing threads (data migrated); mobile dev build on the S24, the web app, and the Mac desktop app show no branding at all: no logo, wordmark, or name inside the UI, plain splash (screenshots of every screen, splash, launcher, notification, About) |
| P2 Tailscale only                           | Configure the Mac mini and two Windows hosts as described above, using the desktop host or `cz serve --tailscale-serve`; clients pair once per machine with `cz pair --tailscale` (both commands already exist in T3, renamed). Reuse optional web/desktop load balancing; keep mobile's manual host selection. Connect sign-in, Clerk, relay code, and the push-registration UI removed from server, web, and mobile (`infra/relay` deleted)                                                                                                                                                                      | Phone pairs with all three hosts over Tailscale, off home Wi-Fi, and starts an agent on each awake host using its local provider setup; web/desktop auto balance chooses eligible connected hosts for a grouped project and existing threads stay on their host; network log shows no request to any T3 host                                                                                                  |
| P3 Decisions in the cz server               | Decision service in `apps/server` (contracts from `packages/inbox-client` moved into `packages/contracts`): every kind, per-option reactions, redlines, passage comments, uploads, `blocking`/`default`/`expires_at`/`cost_note`/`resume`/`thread`, media storage, long-poll wait, history; RPC for clients; MCP tools for agents with the "when to ask" rules in their descriptions; `cz inbox` CLI; one-time import of ccez-inbox items and media (legacy kinds mapped)                                                                                                                                          | Server + CLI + MCP tests for every kind; imported items match the Worker's counts; an agent submits one of each kind via MCP and reads answers back                                                                                                                                                                                                                                                           |
| P4 Decisions tab                            | Decisions tab in T3's design system with Darkroom's interaction ideas (DECISIONS.md, Look and feel): feed (blocking first, then project priority, then age), filters, review session, and full-screen views for all 10 types: Pick, Review (with redline drawing), Listen (keep/kill/favourite, loop, "more like these", in-context playback), Look (3D: orbit, animations, clay/wireframe, scale figure, side-by-side; WebView `<model-viewer>` on mobile), Read (passage comments), Playtest (APK install + feedback form), Rank, Pitch, Request (upload/type/record), Timeline (genforge steps, redo from here) | Playwright (web) + Maestro or Detox (mobile) tests per type; on the S24 the owner answers one of each type and each agent reads its answer; ccez-inbox Worker, PWA, and DNS retired (owner approves)                                                                                                                                                                                                          |
| P5 Links + resume + reset queue             | Thread ↔ decision links (chip in the thread, link in the decision); Threads list marks threads with open decisions; the cz server starts resume threads with the decision attached when an answer arrives for an agent that moved on; the reset queue ported from nightshift into the server (**"Run at next reset"** on the send button, the queue on Usage → Limits, `cz queue`), callers moved off `ns`, then `~/SWE/nightshift` deleted (owner approved); resumes use the queue when quotas are spent                                                                                                          | An agent submits a non-blocking Listen and ends its thread; the owner answers on the phone; a resume thread starts and continues with the kept sounds. A task sent with "Run at next reset" at night starts after the reset                                                                                                                                                                                   |
| P6 Ship                                     | Android release APK signed with czcode's own release key (`ccez/release/android.sh`; key in `~/.config/czcode`, password in Keychain), installed on the S24, auto-update path (Play internal testing or in-app APK update); unsigned Mac desktop build (no Apple Developer ID, owner 2026-10-05: first launch needs right-click → Open); no iOS                                                                                                                                                                                                                                                                    | Owner uses only cz for 3 days; issues fixed                                                                                                                                                                                                                                                                                                                                                                   |
| P7 Terminal app                             | `cz tui` and the `ct` alias: threads (list, open, live output, reply, approvals, diffs), Decisions (all 10 kinds: images inline, redlines by mouse, 3D, audio, playtest installs), the reset queue, and usage, with parity to the desktop app; the owner's nvim image hook                                                                                                                                                                                                                                                                                                                                         | In a toggleterm float on the Mac, the owner runs a thread end to end and answers one decision of each kind; images render and follow the float; the same thread and answers show on the phone                                                                                                                                                                                                                 |
| P8 Upstream sync                            | Weekly agent task (the cz reset queue): regenerate `upstream-cz` with the codemod, merge into `main`, resolve conflicts (extend the codemod when upstream adds new T3 names), run rename check + typecheck + tests + mobile static check, rebuild, log in `ccez/docs/upstream-sync.md`. Upstream changes to the relay or Connect are dropped                                                                                                                                                                                                                                                                       | Two consecutive weekly syncs merged with all gates green                                                                                                                                                                                                                                                                                                                                                      |
| P9 Push (optional, when the owner wants it) | Direct Firebase push from each cz server (thread finished, needs input, new blocking decision, daily digest), reusing the relay's FCM payload format; the owner's Firebase project                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pushes arrive on the S24 with the app backgrounded; tapping opens the thread or decision                                                                                                                                                                                                                                                                                                                      |

Who: one Opus 5.5 thread builds P0-P7 in order without stopping between
phases; the owner approved retiring the ccez-inbox Worker, inbox.ccez.uk,
and nightshift once their replacements work (2026-10-05). Muse runs P8 weekly.

## Rules

- **Licence:** MIT requires keeping T3 Tools' copyright notice. `LICENSE`
  keeps the original notice and adds the owner's line; a `NOTICE` file says
  cz is a modified fork of T3 Code. Those two files are the only places the
  T3 name stays.
- Fork-only code goes in new files and packages where possible, so upstream
  merges stay small.
- `~/SWE/ccez-inbox` and `~/SWE/nightshift` are read-only sources until
  retired: import from them, don't change them.
- Retiring the Worker, DNS, repo renames, and store submissions are
  outward-facing: ask the owner first. Never commit Firebase keys, Access
  tokens, or signing secrets.
