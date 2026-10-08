/**
 * Decision media in a terminal: downloaded once to a cache, then shown inline
 * (images, 3D turntable frames) or handed to the tools the owner's neovim
 * already uses: mpv for sound and video, f3d for free 3D orbit, adb for APKs.
 *
 * @module media
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@cz/shared/hostProcess";

export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".cache");
  const dir = NodePath.join(base, "czcode", "tui", "media");
  NodeFS.mkdirSync(dir, { recursive: true });
  return dir;
}

const safeName = (key: string) =>
  `${NodeCrypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}-${
    key
      .split("/")
      .pop()
      ?.replace(/[^\w.-]/g, "_") ?? "file"
  }`;

/** Downloads a signed media URL once; later calls return the cached path. */
export async function cachedMedia(key: string, url: string): Promise<string> {
  const path = NodePath.join(cacheDir(), safeName(key));
  if (NodeFS.existsSync(path)) return path;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  NodeFS.writeFileSync(`${path}.partial`, new Uint8Array(await response.arrayBuffer()));
  await run("mv", [`${path}.partial`, path]);
  return path;
}

function run(command: string, args: ReadonlyArray<string>, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) =>
    NodeChildProcess.execFile(command, [...args], { timeout }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  );
}

/** A PNG of the image (converted with magick when it isn't one), for the Kitty protocol. */
export async function pngFor(path: string): Promise<Uint8Array> {
  const bytes = NodeFS.readFileSync(path);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return bytes;
  const out = `${path}.png`;
  if (!NodeFS.existsSync(out)) await run("magick", [`${path}[0]`, out]);
  return NodeFS.readFileSync(out);
}

export const TURNTABLE_FRAMES = 12;

/** One turntable frame of a model (30° steps), rendered headless by f3d and cached. */
export async function turntableFrame(path: string, frame: number, clay: boolean): Promise<string> {
  const angle =
    (((frame % TURNTABLE_FRAMES) + TURNTABLE_FRAMES) % TURNTABLE_FRAMES) * (360 / TURNTABLE_FRAMES);
  const out = `${path}.${clay ? "clay" : "lit"}.${angle}.png`;
  if (NodeFS.existsSync(out)) return out;
  await run("f3d", [
    path,
    "--no-config",
    "--resolution=640,480",
    `--camera-azimuth-angle=${angle}`,
    ...(clay
      ? ["--color=#c8bfb2", "--roughness=0.9", "--metallic=0", "-D", "model.color.texture="]
      : []),
    `--output=${out}`,
  ]);
  return out;
}

/** Opens a model in f3d's own window for free orbit; it outlives the TUI. */
export function openInF3d(path: string): void {
  NodeChildProcess.spawn("f3d", [path], { detached: true, stdio: "ignore" }).unref();
}

/** Plays sound or video with mpv (video in its own window); stop by killing the handle. */
export function play(path: string, video: boolean, loop = false): NodeChildProcess.ChildProcess {
  return NodeChildProcess.spawn(
    "mpv",
    [
      ...(video ? [] : ["--no-video"]),
      ...(loop ? ["--loop-file=inf"] : []),
      "--really-quiet",
      path,
    ],
    { stdio: "ignore" },
  );
}

/** Installs an APK on the connected phone. Resolves to adb's last line. */
export async function adbInstall(path: string): Promise<string> {
  const out = await run("adb", ["install", "-r", path], 300_000);
  return out.trim().split("\n").pop() ?? "";
}

/** Anything else: the OS default app. */
export function openWithSystem(path: string): void {
  NodeChildProcess.spawn(
    HostProcessPlatform.defaultValue() === "darwin" ? "open" : "xdg-open",
    [path],
    {
      detached: true,
      stdio: "ignore",
    },
  ).unref();
}
