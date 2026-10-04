# cz: one app for agents and decisions (T3 Code fork + ccez-inbox)

Decided by the owner 2026-10-04: one app for everything, named **cz**. Agent
threads (from T3 Code) and decisions with media (from ccez-inbox) live in
the same app on the phone, the Mac desktop, and the browser. **Nothing named
T3 remains anywhere:** not the app, the CLI, the server, packages, config
folders, env vars, or hostnames. Nothing is routed through T3's hosted
services.

This folder (`ccez/`) holds everything fork-specific that isn't product code:
this plan, phase logs (`ccez/docs/phase-N.md`), brand sources, the rename
script, and the upstream sync log.

## What exists today

- **T3 Code** (this repo, fork of `pingdotgg/t3code`, MIT, TypeScript):
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

- **One app, cz.** Tabs: **Threads** (agent threads as T3 has them today),
  **Inbox** (decisions), **Fleet** (machines, quotas, nightshift queue),
  **Settings**. On Android (Expo), on the Mac (Tauri desktop), and in any
  browser (web app).
- **CLI and server: `cz`.** `cz serve`, `cz pair`, `cz service install`,
  `cz update`; data in `~/.cz` (migrated from `~/.t3` on first run); env vars
  `CZ_*`; package scope `@cz/*`; schemes `cz://`; bundle IDs `uk.ccez.cz`
  (`.dev`, `.preview`).
- **The inbox backend stays.** The Worker, D1, R2, the item model, and the
  `inbox` CLI/MCP don't change, so genforge, nightshift, and every agent keep
  working untouched. cz becomes a new client of that API.
- **The inbox PWA is retired** once the Inbox tab reaches parity (P5). Until
  then it keeps working and keeps getting improvements.
- **No hosted middleman:** devices reach machines over **Tailscale**; T3
  Connect's relay and Clerk sign-in are removed. Push goes straight from the
  owner's machines (threads) and the inbox Worker (decisions) to the owner's
  own Firebase project. No analytics leave the owner's machines.
- **Desktop: Tauri 2, not Electron** (owner's call, 2026-10-04; same stack as
  ccez-llm and ccez-daw). The Tauri shell is Rust; the cz server stays
  TypeScript and runs as a sidecar process (or as the already-running
  background service). Known trade: on macOS Tauri renders with WebKit
  (Safari's engine), not Chromium, so the web UI must be checked and fixed
  on WebKit (OpenCode hit style and performance differences when they were on
  Tauri). Electron-only features (Chromium web-preview browser, cookie import
  from other browsers) are dropped unless the owner asks for them back.
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
| P0 Brand | Owner picks the cz icon (2-4 options via the inbox). Brand sources in `ccez/brand/`; one config module for app name, scheme, bundle IDs, hostnames, update feed | Owner's pick recorded |
| P1 Rename | The codemod in `ccez/rename/` + `upstream-cz` branch flow; run it on `main`: packages `@cz/*`, CLI/server `cz`, `~/.cz` with migration from `~/.t3`, `CZ_*` env vars (old names read as fallback once, with a warning), icons, splash, favicons, notification and adaptive icons, iOS Icon Composer projects, bundle IDs, schemes, deep links; remove `apps/marketing`; **PostHog analytics removed**; README rewritten. Ask the owner before renaming the GitHub repo (`chris-straka/t3code` → `chris-straka/cz`) and the local folder (`~/SWE/t3code` → `~/SWE/cz`), since T3 project paths, nightshift config, and docs point at them | `ccez/rename/check` passes (zero T3 names outside the allowlist); typecheck + tests + mobile static check pass; `cz serve` runs on the Mac and keeps existing threads (data migrated); mobile dev build on the S24 and the web app show only the cz brand (screenshots of every screen, splash, launcher, notification, About) |
| P2 Tailscale + direct push | **Connection:** every machine runs `cz serve --tailscale-serve`; the phone pairs once per machine with `cz pair --tailscale`; Connect sign-in, Clerk, and relay code removed from server, web, and mobile (`infra/relay` deleted). **Push:** new `DirectPush` server service: when agent activity changes (finished, failed, needs approval, asks for input), the machine's cz server sends it to Firebase Cloud Messaging (HTTP v1) itself, using the owner's Firebase service-account key from the Keychain; the phone registers its FCM token with each paired machine over the existing authenticated connection; reuse the relay's payload format (`fcmPayloads.ts`) so notification handling, Live Updates, and tap-to-open-thread work unchanged. APNs later, when iOS starts | Phone pairs with the Mac and a second box over Tailscale, off home Wi-Fi; "thread finished" and "needs input" pushes arrive on the S24 with the app backgrounded and after a reopen; tapping opens the thread; network log shows no request to any T3 host |
| P3 Desktop (Tauri) | `apps/desktop-tauri`: Tauri 2 shell (Rust) loading the web app; starts the cz server as a sidecar or attaches to the background service; tray icon with thread status, native notifications, global shortcut, deep links (`cz://`), auto-update from GitHub releases; `apps/desktop` (Electron) removed. WebKit pass: every web screen checked in the Tauri window, style and performance fixes landed in `apps/web` | Mac build launches, connects, streams a long agent thread at 60 FPS scroll with no visual differences vs Chrome on a screen-by-screen screenshot comparison; RAM and idle CPU recorded next to the Electron build; tray, notification, deep link, and update all work |
| P4 Inbox tab | `packages/inbox-client` (typed client for the inbox API, shared by web, desktop, and mobile); cz authenticates to the inbox Worker with a per-device Cloudflare Access service token (created during pairing, stored in the OS keystore; ask the owner before the Access change), so there's no separate sign-in; Inbox tab: feed with project/kind filters, swipe approve/reject, item view, pick/rank/A-B compare, comments | Playwright (web) + Maestro or Detox (mobile) tests; owner answers a 3-image pick in cz and the waiting agent reads it |
| P5 Media + parity | GLB viewer (the inbox's `<model-viewer>` page inside `react-native-webview` on mobile, native element on web/desktop), audio/video (`expo-audio`, `expo-video`), voice notes (reuse the existing voice input), build items with APK install, pitch → task, digest; the inbox Worker sends its pushes to the same Firebase project and cz shows them alongside thread pushes | Every item kind the PWA renders also renders in cz (checklist + screenshots); GLB rotates on the S24; APK installs from an item; PWA retired: inbox.ccez.uk serves only the API plus a redirect page |
| P6 Fuse | Fleet tab (merge the inbox fleet panel with the environment list: quotas, reset countdowns, nightshift queue, queue a task); item → thread deep link; open items shown inline in their thread; genforge production timelines (genforge P7) render as a step strip with "redo from here" | Owner queues a task at night from the Fleet tab, it runs after reset, its result arrives as an inline item in that thread |
| P7 Ship | Android release APK signed with the owner's key, installed on the S24, auto-update path (Play internal testing or in-app APK update); signed Tauri Mac build; iOS later via TestFlight ($99/yr) | Owner uses only cz for 3 days; issues fixed |
| P8 Upstream sync | Weekly agent task (nightshift): regenerate `upstream-cz` with the codemod, merge into `main`, resolve conflicts (extend the codemod when upstream adds new T3 names), run rename check + typecheck + tests + mobile static check, rebuild, log in `ccez/docs/upstream-sync.md`. Upstream changes to Electron, the relay, or Connect are dropped; useful desktop changes are ported to Tauri by hand | Two consecutive weekly syncs merged with all gates green |

Who: one Opus 5.5 thread builds P0-P7 in order without stopping between
phases, except at P0 (owner's icon pick), before renaming the GitHub repo or
local folder, and before any Cloudflare Access change (outward-facing: ask
first). Muse runs P8 weekly.

## Rules

- **Licence:** MIT requires keeping T3 Tools' copyright notice. `LICENSE`
  keeps the original notice and adds the owner's line; a `NOTICE` file says
  cz is a modified fork of T3 Code. Those two files are the only places the
  T3 name stays.
- Fork-only code goes in new files and packages where possible, so upstream
  merges stay small.
- **Don't touch `~/SWE/ccez-inbox` from this plan's threads** while another
  agent works there; changes to the inbox Worker (Access service tokens,
  FCM) go in as PRs or after that agent finishes.
- Worker auth changes, DNS, repo renames, and store submissions are
  outward-facing: ask the owner first. Never commit Firebase keys, Access
  tokens, or signing secrets.
