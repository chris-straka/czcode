/**
 * UI guardrails: visits every main view with seeded data at phone, tablet and
 * wide widths plus an emulated macOS desktop shell, and fails when generic DOM
 * geometry checks find a basic mistake (see ui-guardrails/checks.ts). Each
 * failing view gets a screenshot with the offending boxes outlined.
 *
 *   vp run --filter @cz/web --filter cz build   # once, or after changing the UI
 *   node ccez/tests/ui-guardrails.ts [--shots] [--only <view>] [--out <dir>]
 *
 * --shots saves a screenshot of every view, not just failing ones.
 * A real bug owned by another change can be tolerated for a while by adding
 * its printed key to ui-guardrails/known-issues.json with a note; the run
 * says when the entry is no longer needed.
 * Runs a throwaway server on a temp cz home, so it never touches ~/.cz.
 * Uses Playwright's Chromium when installed, else Google Chrome.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { Browser, BrowserContext, Page } from "playwright-core";

import {
  SHOWCASE_PROJECT_ID,
  SHOWCASE_THREAD_ID,
  seedShowcaseEnvironment,
} from "../../scripts/mobile-showcase-environment.ts";
import {
  type Box,
  type CheckOptions,
  type Violation,
  collectViolations,
  drawTrafficLights,
  drawViolations,
} from "./ui-guardrails/checks.ts";

const repo = new URL("../..", import.meta.url).pathname;
// The server's playwright-core: CI installs its Chromium.
const { chromium } = NodeModule.createRequire(NodePath.join(repo, "apps/server/package.json"))(
  "playwright-core",
) as typeof import("playwright-core");

const { values: args } = NodeUtil.parseArgs({
  options: {
    shots: { type: "boolean", default: false },
    only: { type: "string" },
    out: { type: "string" },
  },
});
const outDir = NodePath.resolve(
  args.out ?? process.env.UI_GUARDRAILS_OUT ?? NodePath.join(NodeOS.tmpdir(), "cz-ui-guardrails"),
);

// macOS 26+ window buttons: 14pt circles from x=16, centred in the 52px top bar
// (apps/desktop/src/window/DesktopWindow.ts), ending near x=74.
const TRAFFIC_LIGHTS: Box = { x: 16, y: 19, width: 58, height: 14 };
const TRAFFIC_LIGHT_GAP = 8;

interface Mode {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly desktop?: { readonly fullscreen: boolean };
}
const MODES: ReadonlyArray<Mode> = [
  { name: "390", width: 390, height: 844 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1600", width: 1600, height: 1000 },
  { name: "desktop", width: 1280, height: 800, desktop: { fullscreen: false } },
];

// Tiny valid media, enough for each Decision view to render.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function wav(): Buffer {
  const samples = 800;
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples * 2, 40);
  return out;
}

async function startServer(home: string, workspaceRoot: string) {
  const port = 47_000 + Math.floor(Math.random() * 1_000);
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(repo, "apps/server/dist/bin.mjs"),
      "serve",
      "--base-dir",
      home,
      "--port",
      String(port),
      "--no-browser",
      workspaceRoot,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const pairingUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${output}`)), 90_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Pairing URL: (\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    child.stdout!.on("data", read);
    child.stderr!.on("data", read);
    child.on("exit", (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  });
  // Pair over loopback whatever address the server advertises.
  const url = new URL(pairingUrl);
  url.hostname = "127.0.0.1";
  return { child, pairingUrl: url.href, origin: url.origin };
}

async function stop(child: NodeChildProcess.ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  const stuck = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(stuck);
}

/** Calls the server from the paired page, so its session cookie authenticates. */
async function api<T>(page: Page, path: string, init: { json?: unknown; bytes?: Buffer } = {}) {
  const result = await page.evaluate(
    async ({ path, json, bytes }) => {
      const body =
        bytes !== undefined
          ? Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))
          : json === undefined
            ? undefined
            : JSON.stringify(json);
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": bytes !== undefined ? "application/octet-stream" : "application/json",
        },
        body,
      });
      return { status: response.status, text: await response.text() };
    },
    { path, json: init.json, bytes: init.bytes?.toString("base64") },
  );
  if (result.status >= 300) throw new Error(`${path}: ${result.status} ${result.text}`);
  return JSON.parse(result.text) as T;
}

async function upload(page: Page, name: string, mime: string, type: string, bytes: Buffer) {
  const query = new URLSearchParams({ name, mime, type });
  return api<{ key: string }>(page, `/api/decisions/media?${query}`, { bytes });
}

const PITCH = { project: "czcode", kind: "pitch", question: "Make a sequel to the jam game?" };

/** One open Decision of every kind, with realistic lengths of text. */
async function seedDecisions(page: Page): Promise<Record<string, string>> {
  const image = (name: string) => upload(page, name, "image/png", "image", PNG);
  const sound = (name: string) => upload(page, name, "audio/wav", "audio", wav());
  const [a, b, mockup, kick, snare, step1, step2] = await Promise.all([
    image("cover-a.png"),
    image("cover-b.png"),
    image("mockup.png"),
    sound("kick.wav"),
    sound("snare.wav"),
    image("blockout.png"),
    image("rig.png"),
  ]);
  const base = { project: "czcode" };
  const items: Record<string, Record<string, unknown>> = {
    pick: {
      ...base,
      kind: "pick",
      question: "Which cover for the immigration channel's first video?",
      media: [a, b],
      options: [
        {
          id: "a",
          label: '1 · "3 Express Entry draws in 4 days: what a CRS of 476 means"',
          media_idx: 0,
          recommended: true,
        },
        {
          id: "b",
          label: '2 · "US immigration fees are going up: in force vs proposed"',
          media_idx: 1,
        },
      ],
    },
    review: {
      ...base,
      kind: "review",
      question: "Does the settings mockup work?",
      body_md: "Approve, reject, or ask for changes.",
      media: [mockup],
    },
    listen: {
      ...base,
      kind: "listen",
      question: "Which drums fit the adaptive theme?",
      media: [kick, snare],
      options: [
        { id: "kick", label: "Kick", media_idx: 0 },
        { id: "snare", label: "Snare", media_idx: 1 },
      ],
    },
    read: {
      ...base,
      kind: "read",
      question: "Read the intro to the plan",
      body_md:
        "The first paragraph sets the scene.\n\nThe second paragraph goes on a while longer.",
    },
    rank: {
      ...base,
      kind: "rank",
      question: "Rank the channel names",
      options: [
        { id: "a", label: "Alpha", media_idx: null },
        { id: "b", label: "Bravo", media_idx: null },
        { id: "c", label: "Charlie", media_idx: null },
      ],
    },
    pitch: PITCH,
    request: { ...base, kind: "request", question: "Send the reference notes for the rig" },
    timeline: {
      ...base,
      kind: "timeline",
      question: "Approve the character run?",
      media: [step1, step2],
      steps: [
        { id: "s1", label: "Blockout", media_idx: 0, status: "done" },
        { id: "s2", label: "Rig", media_idx: 1, status: "failed" },
      ],
    },
  };
  const ids: Record<string, string> = {};
  for (const [kind, input] of Object.entries(items)) {
    const json = { ...input, title: input.question };
    ids[kind] = (await api<{ id: string }>(page, "/api/decisions", { json })).id;
  }
  return ids;
}

interface View {
  readonly name: string;
  readonly path: string;
  /** Something that only renders once the view has its data. */
  readonly ready?: string;
  /** Brings up a transient layer (menu, toast) before the checks run. */
  readonly open?: (page: Page) => Promise<void>;
}

function views(environmentId: string, decisions: Record<string, string>): View[] {
  const settings = [
    "general",
    "appearance",
    "keybindings",
    "snap-shot",
    "providers",
    "integrations",
    "scheduled-tasks",
    "source-control",
    "storage",
    "connections",
    "projects",
    "archived",
    "diagnostics",
  ];
  return [
    { name: "home", path: "/", ready: "[data-decision-card]" },
    { name: "threads", path: "/threads" },
    { name: "threads-project", path: `/threads?project=${SHOWCASE_PROJECT_ID}` },
    ...Object.entries(decisions)
      .filter(([kind]) => kind !== "toast")
      .map(([kind, id]) => ({
        name: `decision-${kind}`,
        path: `/decisions?open=${encodeURIComponent(`${environmentId}:${id}`)}`,
        ready: `[data-decision-kind="${kind}"]`,
      })),
    { name: "thread", path: `/${environmentId}/${SHOWCASE_THREAD_ID}` },
    { name: "schedules", path: "/schedules" },
    { name: "usage", path: "/usage" },
    { name: "fleet", path: "/fleet" },
    { name: "pull-requests", path: "/pull-requests" },
    ...settings.map((page) => ({ name: `settings-${page}`, path: `/settings/${page}` })),
    {
      name: "home-machines-menu",
      path: "/",
      ready: "[data-decision-card]",
      open: async (page) => {
        await page
          .getByRole("button", { name: /machines/i })
          .first()
          .click();
        await page
          .locator('[role="menu"], [role="listbox"], [data-slot$="popup"]')
          .first()
          .waitFor();
      },
    },
    {
      // Answering from the full view raises an Undo toast over the header (51.png).
      name: "decision-toast",
      // Read late: each mode asks a fresh Decision just before this view.
      get path() {
        return `/decisions?open=${encodeURIComponent(`${environmentId}:${decisions.toast}`)}`;
      },
      ready: '[data-decision-kind="pitch"]',
      open: async (page) => {
        await page.locator("footer").getByRole("button", { name: "Later", exact: true }).click();
        await page.locator('[data-slot="toast-close"]').first().waitFor();
      },
    },
  ];
}

const QUIET_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}`;

async function newContext(
  browser: Browser,
  mode: Mode,
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
  origin: string,
) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: mode.width, height: mode.height },
    reducedMotion: "reduce",
  });
  await context.addCookies(cookies);
  await context.addInitScript(
    ({ desktop, origin }) => {
      const key = "czcode:client-settings:v1";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({ onboardingCompletedAt: new Date().toISOString() }),
        );
      }
      if (!desktop) return;
      // Enough of the Electron preload for the web app to lay out as the macOS
      // desktop shell: it detects Electron by this bridge.
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
      const known: Record<string, unknown> = {
        getClientPlatform: () => "darwin",
        getAppBranding: () => null,
        getSystemLocale: () => "en-US",
        getWindowFullscreenState: () => desktop.fullscreen,
        getLocalEnvironmentEnabled: () => true,
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Local",
            httpBaseUrl: origin,
            wsBaseUrl: origin.replace(/^http/, "ws"),
          },
        ],
        getClientSettings: async () => null,
        preview: undefined,
        appActivation: undefined,
      };
      (window as unknown as { desktopBridge: unknown }).desktopBridge = new Proxy(known, {
        get(target, name) {
          if (typeof name !== "string" || name === "then") return undefined;
          if (name in target) return target[name];
          if (/^on[A-Z]/.test(name)) return () => () => {};
          if (/^(list|discover)|Endpoints$/.test(name)) return async () => [];
          return async () => null;
        },
      });
    },
    { desktop: mode.desktop ?? null, origin },
  );
  return context;
}

interface Result {
  readonly mode: string;
  readonly view: string;
  readonly violations: ReadonlyArray<Violation>;
  readonly screenshot: string | null;
}

async function checkView(page: Page, mode: Mode, view: View): Promise<Result> {
  // The desktop app routes by hash.
  await page.goto(mode.desktop ? `/#${view.path}` : view.path);
  await page.addStyleTag({ content: QUIET_MOTION });
  if (view.ready) await page.locator(view.ready).first().waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await view.open?.(page);
  await page.waitForTimeout(300);
  const options: CheckOptions = {
    trafficLights: mode.desktop && !mode.desktop.fullscreen ? TRAFFIC_LIGHTS : null,
    trafficLightGap: TRAFFIC_LIGHT_GAP,
  };
  const violations = await page.evaluate(collectViolations, options);
  let screenshot: string | null = null;
  if (violations.length > 0 || args.shots) {
    if (options.trafficLights) await page.evaluate(drawTrafficLights, options.trafficLights);
    if (violations.length > 0) await page.evaluate(drawViolations, violations);
    screenshot = NodePath.join(outDir, `${mode.name}-${view.name}.png`);
    await page.screenshot({ path: screenshot });
  }
  return { mode: mode.name, view: view.name, violations, screenshot };
}

interface KnownIssue {
  readonly key: string;
  readonly note: string;
}
const known: ReadonlyArray<KnownIssue> = JSON.parse(
  NodeFS.readFileSync(new URL("ui-guardrails/known-issues.json", import.meta.url), "utf8"),
);

// Each check against the bug that prompted it (ui-guardrails/fixture.html).
const FIXTURE_EXPECTED = [
  "traffic-lights",
  "drag-region",
  "covered",
  "duplicate",
  "select",
  "cursor",
  "overlap",
  "icon-overlap",
  "text-overflow",
  "text-clipped",
  "offscreen",
  "spacing",
];

async function selfTest(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.setContent(
    NodeFS.readFileSync(new URL("ui-guardrails/fixture.html", import.meta.url), "utf8"),
  );
  const found = await page.evaluate(collectViolations, {
    trafficLights: TRAFFIC_LIGHTS,
    trafficLightGap: TRAFFIC_LIGHT_GAP,
  });
  await page.close();
  const missed = FIXTURE_EXPECTED.filter((check) => !found.some((v) => v.check === check));
  if (missed.length > 0) {
    throw new Error(
      `ui-guardrails self-test: no longer catches ${missed.join(", ")} in fixture.html.\nFound:\n  ${found.map((v) => `[${v.check}] ${v.message}`).join("\n  ")}`,
    );
  }
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: "chrome" });
  }
}

const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cz-ui-guardrails-"));
const workspaceRoot = NodePath.join(home, "workspace", "czcode");
NodeFS.mkdirSync(workspaceRoot, { recursive: true });
NodeFS.rmSync(outDir, { recursive: true, force: true });
NodeFS.mkdirSync(outDir, { recursive: true });
let server: NodeChildProcess.ChildProcess | undefined;
let browser: Browser | undefined;
let failed = false;
try {
  // Seed the showcase threads into the V1 tables, then restart: the server
  // imports V1 history into the V2 projections the clients read at startup.
  const first = await startServer(home, workspaceRoot);
  server = first.child;
  await seedShowcaseEnvironment({ baseDir: home });
  await stop(server);
  const started = await startServer(home, workspaceRoot);
  server = started.child;
  const environmentId = NodeFS.readFileSync(
    NodePath.join(home, "userdata", "environment-id"),
    "utf8",
  ).trim();

  browser = await launch();
  await selfTest(browser);
  const pairing = await browser.newContext();
  const pairPage = await pairing.newPage();
  await pairPage.goto(started.pairingUrl);
  await pairPage.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 30_000 });
  const decisions = await seedDecisions(pairPage);
  const cookies = await pairing.cookies();
  await pairing.close();

  const results: Result[] = [];
  const pageErrors: string[] = [];
  for (const mode of MODES) {
    const context = await newContext(browser, mode, cookies, started.origin);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(`${mode.name}: ${error.message}`));
    for (const view of views(environmentId, decisions)) {
      if (args.only && !view.name.includes(args.only)) continue;
      // The toast scenario answers its Decision; ask a fresh one each mode.
      if (view.name === "decision-toast") {
        const json = { ...PITCH, question: "Ship the jam build?", title: "Ship the jam build?" };
        decisions.toast = (await api<{ id: string }>(page, "/api/decisions", { json })).id;
      }
      try {
        results.push(await checkView(page, mode, view));
      } catch (error) {
        const screenshot = NodePath.join(outDir, `${mode.name}-${view.name}-error.png`);
        await page.screenshot({ path: screenshot }).catch(() => {});
        results.push({
          mode: mode.name,
          view: view.name,
          screenshot,
          violations: [
            {
              check: "load",
              message: String(error).split("\n")[0]!,
              key: `load ${view.name}`,
              boxes: [],
            },
          ],
        });
      }
    }
    await context.close();
  }

  // Desktop full screen: no window buttons, so the bar starts at the edge gap.
  {
    const mode: Mode = {
      name: "desktop-fullscreen",
      width: 1280,
      height: 800,
      desktop: { fullscreen: true },
    };
    const context = await newContext(browser, mode, cookies, started.origin);
    const page = await context.newPage();
    await page.goto("/#/");
    await page.locator("[data-decision-card]").first().waitFor();
    const left = await page.evaluate(() => {
      const first = document.querySelector("header button, header a[href]");
      return first ? first.getBoundingClientRect().left : null;
    });
    const violations: Violation[] =
      left !== null && left > 16
        ? [
            {
              check: "fullscreen",
              message: `full screen still leaves room for window buttons (first control at ${Math.round(left)}px)`,
              key: "fullscreen inset",
              boxes: [],
            },
          ]
        : [];
    results.push({ mode: mode.name, view: "home", violations, screenshot: null });
    await context.close();
  }

  // Report: known issues are listed but don't fail; anything new does.
  const seenKeys = new Set<string>();
  const lines: string[] = [];
  for (const result of results) {
    const fresh = result.violations.filter((v) => !known.some((k) => k.key === v.key));
    for (const v of result.violations) seenKeys.add(v.key);
    if (fresh.length === 0) continue;
    failed = true;
    lines.push(
      `\n✗ ${result.mode} ${result.view}${result.screenshot ? `  (${result.screenshot})` : ""}`,
    );
    fresh.forEach((v, i) =>
      lines.push(`  ${i + 1}. [${v.check}] ${v.message}\n     key: ${v.key}`),
    );
  }
  const stale = known.filter((k) => !seenKeys.has(k.key));
  const checked = results.length;
  console.log(lines.join("\n"));
  if (pageErrors.length > 0)
    console.log(`\nPage errors (not failing):\n  ${[...new Set(pageErrors)].join("\n  ")}`);
  if (stale.length > 0)
    console.log(
      `\nKnown issues no longer seen; remove them:\n  ${stale.map((k) => k.key).join("\n  ")}`,
    );
  const knownSeen = known.length - stale.length;
  console.log(
    `\nui-guardrails: ${checked} view×mode checks, ${failed ? "FAILED" : "passed"}${knownSeen ? ` (${knownSeen} known issues tolerated)` : ""}. Screenshots: ${outDir}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    NodeFS.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## UI guardrails\n\n${failed ? "Failed: download the `ui-guardrails` artifact for screenshots.\n\n```" + lines.join("\n") + "\n```" : `Passed ${checked} view×mode checks.`}\n`,
    );
  }
} finally {
  await browser?.close();
  if (server) await stop(server);
  NodeFS.rmSync(home, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
