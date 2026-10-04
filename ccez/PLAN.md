# One app: T3 Code rebranded + ccez-inbox merged in

Decided by the owner 2026-10-04: one app for everything. Agent threads
(T3) and decisions with media (ccez-inbox) live in the same app, on the
phone, the web, and the desktop, under the owner's brand, with no T3 branding
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
  P0). Tabs: **Threads** (T3 as today), **Inbox** (decisions), **Fleet**
  (machines, quotas, nightshift queue), **Settings**.
- **The inbox backend stays.** The Worker, D1, R2, the item model, and the
  `inbox` CLI/MCP don't change, so genforge, nightshift, and every agent keep
  working untouched. The app becomes a new client of that API.
- **The inbox PWA is retired** once the Inbox tab reaches parity (P4). Until
  then it keeps working and keeps getting improvements.
- **Self-hosted everything:** relay on the owner's Cloudflare account, the
  owner's Clerk app, the owner's Firebase project for Android push, no T3
  analytics.
- **Thread ↔ decision links both ways:** an inbox item opens its T3 thread;
  a thread shows its open inbox items inline, answerable without leaving it.

## Phases and gates

| Phase | Builds | Gate (numbers + screenshots in `ccez/docs/phase-N.md`) |
|---|---|---|
| P0 Brand | Owner picks the name and icon (2-4 options each via the inbox). Brand sources in `ccez/brand/`; one config module for app name, scheme, bundle IDs, hostnames, update feed, support links | Owner's picks recorded; `rg -i "t3 code\|t3\.codes\|t3tools\.t3code"` over user-visible strings and configs returns only allowed hits (LICENSE, NOTICE, internal package names) |
| P1 Rebrand | Replace names, icons, splash, favicons, notification icon, Android adaptive icons, iOS Icon Composer projects, desktop icons; new bundle IDs/package names (`uk.ccez.app`, `.dev`, `.preview`), URL schemes, deep links; remove `apps/marketing`; desktop updater points at `chris-straka/t3code` releases; **PostHog analytics removed** (no events leave the owner's machines); README rewritten | Mobile dev build on the S24, web, and desktop all show only the new brand (screenshots of every screen, splash, launcher, notification, About); `icons:check` passes; existing tests pass |
| P2 Self-host | Deploy `infra/relay` to the owner's Cloudflare (new zone hostname, e.g. `relay.ccez.uk`); owner's Clerk app (relying party on ccez.uk, Android sign-in redirects, passkeys) per `docs/operations/connect-setup.md`; owner's Firebase project + FCM credentials for Android push (APNs when iOS starts); Tailscale direct connection stays available as a no-relay route | Phone signs in, links the Mac and a second box, opens threads remotely off-tailnet; push "thread finished" arrives on the S24; no request goes to any `t3.codes` host (network log) |
| P3 Inbox tab | `packages/inbox-client` (typed client for the inbox API, shared by web and mobile); inbox Worker accepts the owner's Clerk session (JWT verified at the Worker) alongside Access, so one sign-in covers both; Inbox tab on mobile and web: feed with project/kind filters, swipe approve/reject, item view, pick/rank/A-B compare, comments | Playwright (web) + Maestro or Detox (mobile) tests; owner answers a 3-image pick in the app and the waiting agent reads it |
| P4 Media + parity | GLB viewer (the inbox's `<model-viewer>` page inside `react-native-webview` on mobile, native element on web), audio/video (`expo-audio`, `expo-video`), voice notes (reuse T3's voice input), build items with APK install, pitch → task, digest; inbox pushes through the same FCM channel as thread pushes | Every item kind the PWA renders also renders in the app (checklist + screenshots); GLB rotates on the S24; APK installs from an item; PWA retired: inbox.ccez.uk serves only the API plus a redirect page |
| P5 Fuse | Fleet tab (merge the inbox fleet panel with T3's machine list: quotas, reset countdowns, nightshift queue, queue a task); item → thread deep link; open items shown inline in their thread; genforge production timelines (genforge P7) render as a step strip with "redo from here" | Owner queues a task at night from the Fleet tab, it runs after reset, its result arrives as an inline item in that thread |
| P6 Ship | Android release APK signed with the owner's key, installed on the S24, auto-update path (Play internal testing or in-app APK update); macOS desktop build signed for local use; iOS later via TestFlight ($99/yr) | Owner uses only this app for 3 days; issues fixed |
| P7 Upstream sync | Weekly agent task (nightshift): merge `upstream/main`, resolve conflicts, run typecheck + tests + mobile static check, rebuild, log in `ccez/docs/upstream-sync.md` | Two consecutive weekly syncs merged with all gates green |

Who: one Opus or Sol thread builds P0-P6 in order without stopping between
phases, except at P0 (owner picks) and before P2's deploys (outward-facing:
ask first). Muse runs P7 weekly.

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
  agent works there; changes to the inbox Worker (Clerk JWT, FCM) go in as
  PRs or after that agent finishes.
- Deploys (relay, Worker auth changes, DNS) and store submissions are
  outward-facing: ask the owner first. Never commit Clerk, Firebase, or
  signing secrets.
