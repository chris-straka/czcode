# czcode: one app for agents and decisions (T3 Code fork + ccez-inbox)

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

## Target

- **One app, czcode.** Tabs: **Threads** (agent threads as T3 has them today),
  **Decisions** (judgment calls with media, designed in
  [DECISIONS.md](DECISIONS.md)), plus T3's existing Usage → Limits page
  (gains the reset queue) and **Settings**. No separate Fleet tab: T3 already
  has threads, quotas, reset countdowns, and load balancing. On Android (Expo), on the Mac (Electron desktop), and in any
  browser (web app).
- **CLI and server: `cz`.** `cz serve`, `cz pair`, `cz service install`,
  `cz update`; data in `~/.cz` (migrated from `~/.t3` on first run); env vars
  `CZ_*`; package scope `@cz/*`; schemes `cz://`; bundle IDs `uk.ccez.cz`
  (`.dev`, `.preview`).
- **The inbox backend stays and grows.** The Worker, D1, R2, and the
  `inbox` CLI/MCP stay the way agents (genforge, nightshift, every thread)
  submit decisions; DECISIONS.md lists the new kinds and fields. cz is its
  main client.
- **The inbox PWA is retired** once the Decisions tab covers every type.
- **No hosted middleman:** devices reach machines over **Tailscale**; T3
  Connect's relay and Clerk sign-in are removed. **No push notifications for
  now** (the owner checks in on their own time); an optional later phase adds
  direct Firebase push. No analytics leave the owner's machines.
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

| Phase | Builds | Gate (numbers + screenshots in `ccez/docs/phase-N.md`) |
|---|---|---|
| P0 Name + icon | App name **czcode** (decided). Owner picks a launcher icon from 2-4 minimal, unbranded options (plain shapes or a single glyph, no letters or logo), sent via the inbox. Sources in `ccez/brand/`; one config module for app name, scheme, bundle IDs, hostnames, update feed | Owner's pick recorded |
| P1 Rename | The codemod in `ccez/rename/` + `upstream-cz` branch flow; run it on `main`: packages `@cz/*`, CLI/server `cz`, `~/.cz` with migration from `~/.t3`, `CZ_*` env vars (old names read as fallback once, with a warning), icons, splash, favicons, notification and adaptive icons, iOS Icon Composer projects, bundle IDs, schemes, deep links; Electron desktop renamed (app name, icons, bundle ID, `cz://` deep links, updater pointed at the owner's GitHub releases); remove `apps/marketing`; **PostHog analytics removed**; README rewritten. | `ccez/rename/check` passes (zero T3 names outside the allowlist); typecheck + tests + mobile static check pass; `cz serve` runs on the Mac and keeps existing threads (data migrated); mobile dev build on the S24, the web app, and the Mac desktop app show no branding at all: no logo, wordmark, or name inside the UI, plain splash (screenshots of every screen, splash, launcher, notification, About) |
| P2 Tailscale only | Every machine runs `cz serve --tailscale-serve`; the phone pairs once per machine with `cz pair --tailscale` (both already exist in T3, renamed); Connect sign-in, Clerk, relay code, and the push-registration UI removed from server, web, and mobile (`infra/relay` deleted) | Phone pairs with the Mac and a second box over Tailscale, off home Wi-Fi, and opens threads; network log shows no request to any T3 host |
| P3 Decisions backend | In `~/SWE/ccez-inbox` (after its current agent finishes): new kinds, per-option reactions, redlines, passage comments, uploads, `blocking`/`default`/`expires_at`/`cost_note`/`resume`/`thread` fields with a migration of existing items, `inbox history`, `inbox resume-due`, "when to ask" rules in the MCP tool descriptions (DECISIONS.md, backend section) | Worker + CLI + MCP tests for every kind; old items migrated; an agent submits one of each kind via MCP and reads answers back |
| P4 Decisions tab | `packages/inbox-client` (typed client shared by web, desktop, mobile); per-device inbox token stored in the OS keystore at pairing; Decisions tab in T3's design system with Darkroom's interaction ideas (DECISIONS.md, Look and feel): feed (blocking first, then project priority, then age), filters, review session, and full-screen views for all 10 types: Pick, Review (with redline drawing), Listen (keep/kill/favourite, loop, "more like these", in-context playback), Look (3D: orbit, animations, clay/wireframe, scale figure, side-by-side; WebView `<model-viewer>` on mobile), Read (passage comments), Playtest (APK install + feedback form), Rank, Pitch, Request (upload/type/record), Timeline (genforge steps, redo from here) | Playwright (web) + Maestro or Detox (mobile) tests per type; on the S24 the owner answers one of each type and each agent reads its answer; PWA retired: inbox.ccez.uk serves only the API plus a redirect page |
| P5 Links + resume + reset queue | Thread ↔ decision links (chip in the thread, link in the decision); Threads list marks threads with open decisions; the cz server polls `inbox resume-due` and starts resume threads with the decision attached; **"Run at next reset"** on the send button and the nightshift queue shown on Usage → Limits (nightshift stays the engine); resumes use the queue when quotas are spent | An agent submits a non-blocking Listen and ends its thread; the owner answers on the phone; a resume thread starts and continues with the kept sounds. A task sent with "Run at next reset" at night starts after the reset |
| P6 Ship | Android release APK signed with the owner's key, installed on the S24, auto-update path (Play internal testing or in-app APK update); signed Mac desktop build; iOS later via TestFlight ($99/yr) | Owner uses only cz for 3 days; issues fixed |
| P7 Upstream sync | Weekly agent task (nightshift): regenerate `upstream-cz` with the codemod, merge into `main`, resolve conflicts (extend the codemod when upstream adds new T3 names), run rename check + typecheck + tests + mobile static check, rebuild, log in `ccez/docs/upstream-sync.md`. Upstream changes to the relay or Connect are dropped | Two consecutive weekly syncs merged with all gates green |
| P8 Push (optional, when the owner wants it) | Direct Firebase push from each cz server (thread finished, needs input) and from the inbox Worker (new blocking decision, daily digest), reusing the relay's FCM payload format; the owner's Firebase project | Pushes arrive on the S24 with the app backgrounded; tapping opens the thread or decision |

Who: one Opus 5.5 thread builds P0-P6 in order (P3 waits until the current ccez-inbox agent is done) without stopping between
phases, except at P0 (owner's icon pick; continue with a placeholder plain icon while waiting), and before deploying inbox Worker auth changes (outward-facing: ask
first). Muse runs P7 weekly.

## Rules

- **Licence:** MIT requires keeping T3 Tools' copyright notice. `LICENSE`
  keeps the original notice and adds the owner's line; a `NOTICE` file says
  cz is a modified fork of T3 Code. Those two files are the only places the
  T3 name stays.
- Fork-only code goes in new files and packages where possible, so upstream
  merges stay small.
- **Don't touch `~/SWE/ccez-inbox` from this plan's threads** while another
  agent works there; inbox backend changes (P3) start after that agent finishes.
- Worker auth changes, DNS, repo renames, and store submissions are
  outward-facing: ask the owner first. Never commit Firebase keys, Access
  tokens, or signing secrets.
