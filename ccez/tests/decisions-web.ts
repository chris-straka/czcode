/**
 * End to end check of the web Decisions tab: asks one decision of each kind,
 * answers each through the real UI in headless Chromium, and reads the answers
 * back from the server.
 *
 *   vp run --filter @cz/web --filter cz build   # once, or after changing the UI
 *   node ccez/tests/decisions-web.ts
 *
 * Runs a throwaway server on a temp cz home, so it never touches ~/.cz.
 * Needs Google Chrome installed.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, Page } from "playwright-core";

const repo = new URL("../..", import.meta.url).pathname;
const { chromium } = createRequire(join(repo, "apps/desktop/package.json"))(
  "playwright-core",
) as typeof import("playwright-core");

// Tiny valid media, enough for each view to render.
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
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples * 2, 40);
  return out;
}
function glb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }).padEnd(28, " "));
  const out = Buffer.alloc(12 + 8 + json.length);
  out.write("glTF", 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.write("JSON", 16);
  json.copy(out, 20);
  return out;
}

async function startServer(home: string): Promise<{ child: ChildProcess; pairingUrl: string }> {
  const port = 47_000 + Math.floor(Math.random() * 1_000);
  const child = spawn(
    process.execPath,
    [
      join(repo, "apps/server/dist/bin.mjs"),
      "serve",
      "--base-dir",
      home,
      "--port",
      String(port),
      "--no-browser",
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
  return { child, pairingUrl };
}

/** Calls the server from the paired page, so its session cookie authenticates. */
async function api<T>(
  page: Page,
  path: string,
  init: { method?: string; json?: unknown; bytes?: Buffer } = {},
): Promise<T> {
  const result = await page.evaluate(
    async ({ path, method, json, bytes }) => {
      const body =
        bytes !== undefined
          ? Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))
          : json === undefined
            ? undefined
            : JSON.stringify(json);
      const response = await fetch(path, {
        method,
        headers: {
          "content-type": bytes !== undefined ? "application/octet-stream" : "application/json",
        },
        body,
      });
      return { status: response.status, text: await response.text() };
    },
    {
      path,
      method: init.method ?? (init.json || init.bytes ? "POST" : "GET"),
      json: init.json,
      bytes: init.bytes?.toString("base64"),
    },
  );
  assert.ok(result.status < 300, `${path}: ${result.status} ${result.text}`);
  return JSON.parse(result.text) as T;
}

interface MediaRef {
  readonly key: string;
}

async function upload(page: Page, name: string, mime: string, type: string, bytes: Buffer) {
  const query = new URLSearchParams({ name, mime, type });
  return api<MediaRef>(page, `/api/decisions/media?${query}`, { bytes });
}

async function seed(page: Page): Promise<Record<string, string>> {
  const image = (name: string) => upload(page, name, "image/png", "image", PNG);
  const sound = (name: string) => upload(page, name, "audio/wav", "audio", wav());
  const [red, blue, mockup, kick, snare, model, apk, step1, step2] = await Promise.all([
    image("red.png"),
    image("blue.png"),
    image("mockup.png"),
    sound("kick.wav"),
    sound("snare.wav"),
    upload(page, "hero.glb", "model/gltf-binary", "glb", glb()),
    upload(page, "game.apk", "application/vnd.android.package-archive", "apk", Buffer.from("PK")),
    image("blockout.png"),
    image("rig.png"),
  ]);
  const base = { project: "e2e" };
  const items = {
    pick: {
      ...base,
      kind: "pick",
      question: "Which colour?",
      media: [red, blue],
      options: [
        { id: "red", label: "Red", media_idx: 0 },
        { id: "blue", label: "Blue", media_idx: 1 },
      ],
    },
    review: { ...base, kind: "review", question: "Does the mockup work?", media: [mockup] },
    listen: {
      ...base,
      kind: "listen",
      question: "Which drums?",
      media: [kick, snare],
      options: [
        { id: "kick", label: "Kick", media_idx: 0 },
        { id: "snare", label: "Snare", media_idx: 1 },
      ],
    },
    look: { ...base, kind: "look", question: "Is the hero model right?", media: [model] },
    read: {
      ...base,
      kind: "read",
      question: "Read the intro",
      body_md: "The first paragraph sets the scene.\n\nThe second paragraph rambles on.",
    },
    playtest: { ...base, kind: "playtest", question: "Play the new level", media: [apk] },
    rank: {
      ...base,
      kind: "rank",
      question: "Rank the names",
      options: [
        { id: "a", label: "Alpha", media_idx: null },
        { id: "b", label: "Bravo", media_idx: null },
        { id: "c", label: "Charlie", media_idx: null },
      ],
    },
    pitch: { ...base, kind: "pitch", question: "Make a sequel?" },
    request: { ...base, kind: "request", question: "Send the reference notes" },
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

/** Opens a feed card into its full view. */
async function open(page: Page, kind: string) {
  await page.locator(`[data-decision-card="${kind}"] button`).first().click();
  await page.locator(`[data-decision-kind="${kind}"]`).waitFor();
}

const footerButton = (page: Page, name: string | RegExp) =>
  page.locator("footer").getByRole("button", { name, exact: typeof name === "string" });

async function answerAll(page: Page) {
  await open(page, "pick");
  await page.getByRole("option", { name: "Blue" }).click();
  await footerButton(page, "Send").click();

  await open(page, "review");
  const canvas = page.getByLabel("Draw on the image");
  await page.locator('[data-decision-kind="review"] img').first().waitFor();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await footerButton(page, "Ask for changes").click();

  await open(page, "listen");
  await page.locator('[data-listen-row="kick"]').getByRole("button", { name: "Keep" }).click();
  await page.getByLabel("More like the kept ones").check();
  await footerButton(page, "Send").click();

  await open(page, "look");
  await footerButton(page, "Approve").click();

  await open(page, "read");
  await page.getByText("The second paragraph rambles on.").evaluate((element) => {
    const text = element.firstChild!;
    const range = document.createRange();
    range.setStart(text, "The second paragraph ".length);
    range.setEnd(text, "The second paragraph rambles".length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByLabel("Comment on the selection").fill("Cut this");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await footerButton(page, "Send back").click();

  await open(page, "playtest");
  await page.getByLabel("What felt good").fill("The jump");
  await footerButton(page, "Send").click();

  await open(page, "rank");
  await page.getByRole("button", { name: "Move up" }).nth(1).click();
  await footerButton(page, "Send").click();

  // Straight from the card, and Undo takes the first answer back.
  const pitch = page.locator('[data-decision-card="pitch"]');
  await pitch.getByRole("button", { name: "Never" }).click();
  await page
    .locator("[data-decision-pending]", { hasText: "Make a sequel?" })
    .getByRole("button", { name: "Undo" })
    .click();
  await pitch.getByRole("button", { name: "Later" }).click();

  await open(page, "request");
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("reference notes"),
  });
  await page.getByText("notes.txt").waitFor();
  await page.getByRole("textbox", { name: "Note" }).fill("Here you go");
  await footerButton(page, "Send").click();

  await open(page, "timeline");
  await page.getByRole("tab", { name: /Rig/ }).click();
  await page.getByRole("button", { name: "Redo from here" }).click();
  await footerButton(page, /^Redo from Rig/).click();
}

interface Answered {
  readonly item: { readonly status: string };
  readonly answer: Record<string, unknown> | null;
}

async function readAnswers(page: Page, ids: Record<string, string>) {
  // Answers wait out the 5 second undo window before they send.
  const deadline = Date.now() + 30_000;
  const answers: Record<string, Record<string, unknown>> = {};
  for (const [kind, id] of Object.entries(ids)) {
    for (;;) {
      const result = await api<Answered>(page, `/api/decisions/${id}`);
      if (result.answer) {
        answers[kind] = result.answer;
        break;
      }
      assert.ok(Date.now() < deadline, `${kind} was never answered`);
      await page.waitForTimeout(500);
    }
  }
  return answers;
}

function check(answers: Record<string, Record<string, unknown>>) {
  const { pick, review, listen, look, read, playtest, rank, pitch, request, timeline } =
    answers as Record<string, any>;
  assert.deepEqual(pick.option_ids, ["blue"]);
  assert.equal(review.choice, "changes");
  assert.equal(review.redlines.length, 1);
  assert.ok(review.redlines[0].points.length > 1);
  assert.deepEqual(
    listen.reactions.map((r: any) => [r.option_id, r.verdict]),
    [["kick", "keep"]],
  );
  assert.equal(listen.more_like_these, true);
  assert.equal(look.choice, "approve");
  assert.equal(read.choice, "send_back");
  assert.equal(read.passage_comments[0].quote, "rambles");
  assert.equal(read.passage_comments[0].note, "Cut this");
  assert.equal(playtest.playtest.good, "The jump");
  assert.deepEqual(rank.rank, ["b", "a", "c"]);
  assert.equal(pitch.choice, "later");
  assert.equal(request.uploads.length, 1);
  assert.equal(request.comment, "Here you go");
  assert.equal(timeline.choice, "redo");
  assert.equal(timeline.redo_from, "s2");
}

const home = mkdtempSync(join(tmpdir(), "cz-decisions-e2e-"));
let server: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
try {
  const started = await startServer(home);
  server = started.child;
  // Installed Google Chrome, so no Playwright browser download is needed.
  browser = await chromium.launch({ channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // A fresh cz home would open the first-run wizard over everything.
  await page.addInitScript(() => {
    const key = "czcode:client-settings:v1";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({ onboardingCompletedAt: new Date().toISOString() }),
      );
    }
  });

  await page.goto(started.pairingUrl);
  await page.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 30_000 });
  const ids = await seed(page);
  await page.goto(new URL("/decisions", started.pairingUrl).href);
  await page
    .locator("[data-decision-card]")
    .nth(Object.keys(ids).length - 1)
    .waitFor();

  await answerAll(page);
  check(await readAnswers(page, ids));
  assert.deepEqual(pageErrors, [], "the page threw");
  console.log(`decisions-web: all ${Object.keys(ids).length} kinds answered through the UI`);
} catch (error) {
  const shot = join(tmpdir(), "cz-decisions-e2e-failure.png");
  await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
  console.error(`decisions-web failed; screenshot: ${shot}`);
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server!.once("exit", resolve));
    server.kill();
    const stuck = setTimeout(() => server!.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(stuck);
  }
  rmSync(home, { recursive: true, force: true });
}
