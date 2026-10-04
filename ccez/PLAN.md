# One app: T3 Code rebranded + ccez-inbox merged in

Decided by the owner 2026-10-04: one app for everything. Agent threads
(T3) and decisions with media (ccez-inbox) live in the same app, on the
phone and in the browser, under the owner's brand, with no T3 branding
and nothing routed through T3's hosted services.

This folder (`ccez/`) holds everything fork-specific that isn't code changes:
this plan, phase logs (`ccez/docs/phase-N.md`), brand sources, and the upstream
sync log. Keeping it in its own folder keeps upstream merges clean.

## What exists today

- **T3 Code** (this repo, fork of `pingdotgg/t3code`, MIT): Expo/React Native
  mobile app (`apps/mobile`), React + TanStack Router web app (`apps/web`),
  Electron desktop (`apps/desktop`), the `t3` server that runs on each machine
  (`apps/server`), the T3 Connect relay as a Cloudflare Worker
  (`infra/relay`: Clerk identity, managed tunnels, FCM/APNs push), and an
  Astro marketing site (`apps/marketing`). Mobile already ships
  `react-native-webview`, `expo-audio`, `expo-video`, `expo-notifications`,
  and gesture handling: everything the inbox views need.
- **ccez-inbox** (`~/SWE/ccez-inbox`, live at inbox.ccez.uk): Cloudflare
  Worker + D1 + R2 behind Cloudflare Access; vanilla-TS PWA (feed, item
  view, A/B compare, `<model-viewer>` GLB, audio/video, voice notes, Web Push,
  build install, pitch → task, digest, fleet panel); `inbox` CLI + MCP that
  agents, genforge, and nightshift already use.

## Target

- **One app**, working name **ccez** (owner picks the final name and icon in
  P0), on the phone and in the browser. Tabs: **Threads** (T3 as today), **Inbox** (decisions), **Fleet**
  (machines, quotas, nightshift queue), **Settings**.
- **The inbox backend stays.** The Worker, D1, R2, the item model, and the
  `inbox` CLI/MCP don't change, so genforge, nightshift, and every agent keep
  working untouched. The app becomes a new client of that API.
- **The inbox PWA is retired** once the Inbox tab reaches parity (P4). Until
  then it keeps working and keeps getting improvements.
- **No hosted middleman:** devices reach machines over **Tailscale**; T3
  Connect's relay and Clerk sign-in are not used. Push goes straight from the
  owner's machines (threads) and the inbox Worker (decisions) to the owner's
  own Firebase project. No T3 analytics.
- **No desktop app (decided 2026-10-04):** on the Mac, the `t3` server runs
  as a background service (`t3 service install`) and the owner uses the web
  app in the browser, installed as a browser app for a dock icon. Electron
  only adds an embedded web-preview browser, cookie import, and SSH/WSL
  helpers, none of which this workflow needs. `apps/desktop` stays in the tree
  unbuilt and unbranded (deleting it would conflict with every upstream sync).
- **Thread ↔ decision links both ways:** an inbox item opens its T3 thread;
  a thread shows its open inbox items inline, answerable without leaving it.

## Phases and gates

| Phase | Builds | Gate (numbers + screenshots in `ccez/docs/phase-N.md`) |
|---|---|---|
| P0 Brand | Owner picks the name and icon (2-4 options each via the inbox). Brand sources in `ccez/brand/`; one config module for app name, scheme, bundle IDs, hostnames, update feed, support links | Owner's picks recorded; `rg -i "t3 code\|t3\.codes\|t3tools\.t3code"` over user-visible strings and configs returns only allowed hits (LICENSE, NOTICE, internal package names) |
| P1 Rebrand | Replace names, icons, splash, favicons, notification icon, Android adaptive icons, iOS Icon Composer projects; new bundle IDs/package names (`uk.ccez.app`, `.dev`, `.preview`), URL schemes, deep links; remove `apps/marketing`; **PostHog analytics removed** (no events leave the owner's machines); README rewritten | Mobile dev build on the S24 and the web app show only the new brand (screenshots of every screen, splash, launcher, notification, About); `icons:check` passes; existing tests pass |
| P2 Tailscale + direct push | **Connection:** every machine runs `t3 serve --tailscale-serve`; the phone pairs once per machine with `t3 pair --tailscale`; T3 Connect sign-in and relay UI hidden behind a build flag (code kept for clean merges). **Push:** new `DirectPush` server service: when agent activity changes (finished, failed, needs approval, asks for input), the machine's `t3` server sends it to Firebase Cloud Messaging (HTTP v1) itself, using the owner's Firebase service-account key from the Keychain; the phone registers its FCM token with each paired machine over the existing authenticated connection; reuse the relay's payload format (`infra/relay/src/agentActivity/fcmPayloads.ts`) so the app's notification handling, Live Updates, and tap-to-open-thread work unchanged. APNs later, when iOS starts | Phone pairs with the Mac and a second box over Tailscale, off home Wi-Fi; "thread finished" and "needs input" pushes arrive on the S24 with the app force-closed-then-reopened and backgrounded; tapping opens the thread; network log shows no request to any `t3.codes` host or relay |
| P3 Inbox tab | `packages/inbox-client` (typed client for the inbox API, shared by web and mobile); the app authenticates to the inbox Worker with a per-device Cloudflare Access service token (created during pairing, stored in the OS keystore; ask the owner before the Access change), so there's no separate sign-in; Inbox tab on mobile and web: feed with project/kind filters, swipe approve/reject, item view, pick/rank/A-B compare, comments | Playwright (web) + Maestro or Detox (mobile) tests; owner answers a 3-image pick in the app and the waiting agent reads it |
| P4 Media + parity | GLB viewer (the inbox's `<model-viewer>` page inside `react-native-webview` on mobile, native element on web), audio/video (`expo-audio`, `expo-video`), voice notes (reuse T3's voice input), build items with APK install, pitch → task, digest; the inbox Worker sends its pushes to the same Firebase project and the app shows them alongside thread pushes | Every item kind the PWA renders also renders in the app (checklist + screenshots); GLB rotates on the S24; APK installs from an item; PWA retired: inbox.ccez.uk serves only the API plus a redirect page |
| P5 Fuse | Fleet tab (merge the inbox fleet panel with T3's environment list: quotas, reset countdowns, nightshift queue, queue a task); item → thread deep link; open items shown inline in their thread; genforge production timelines (genforge P7) render as a step strip with "redo from here" | Owner queues a task at night from the Fleet tab, it runs after reset, its result arrives as an inline item in that thread |
| P6 Ship | Android release APK signed with the owner's key, installed on the S24, auto-update path (Play internal testing or in-app APK update); the web app installed as a browser app on the Mac; iOS later via TestFlight ($99/yr) | Owner uses only this app for 3 days; issues fixed |
| P7 Upstream sync | Weekly agent task (nightshift): merge `upstream/main`, resolve conflicts, run typecheck + tests + mobile static check, rebuild, log in `ccez/docs/upstream-sync.md` | Two consecutive weekly syncs merged with all gates green |

Who: one Opus or Sol thread builds P0-P6 in order without stopping between
phases, except at P0 (owner picks) and before any Cloudflare Access change
(outward-facing: ask first). Muse runs P7 weekly.

## Rules

- **Licence:** MIT requires keeping T3 Tools' copyright notice. `LICENSE`
  keeps the original notice and adds the owner's line; a `NOTICE` file says
  this is a modified fork. Remove T3's names, logos, and icons from the
  product (MIT grants no trademark rights, so the rebrand is required anyway).
- **Keep the diff easy to merge:** internal package names (`@t3tools/*`),
  file layout, and code identifiers stay as they are; user-visible strings,
  assets, IDs, and hosts change. Put fork-only code in new files and packages
  where possible.
- **Don't touch `~/SWE/ccez-inbox` from this plan's threads** while another
  agent works there; changes to the inbox Worker (Access service tokens, FCM) go in as
  PRs or after that agent finishes.
- Worker auth changes, DNS, and store submissions are outward-facing: ask
  the owner first. Never commit Firebase keys, Access tokens, or signing
  secrets.
