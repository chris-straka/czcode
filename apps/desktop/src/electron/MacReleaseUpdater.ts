// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- This macOS platform boundary streams a release zip to disk while hashing it, and spawns the detached swap script that must outlive the app.
/**
 * The Mac build's updater. It stands in for electron-updater, which can't
 * apply updates to an unsigned app: it reads the GitHub release feed
 * (macReleaseFeed.ts), downloads and checksums the zip as soon as a newer
 * build appears, stages it next to the installed app, and swaps the bundle
 * from a detached script after the app quits, either to restart into the
 * update or on an ordinary quit.
 */
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as FS from "node:fs";
import * as FSP from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { promisify } from "node:util";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  MAC_SWAP_SCRIPT,
  MacUpdateError,
  macBuildNumber,
  newestMacRelease,
  parseSha256File,
  type MacRelease,
} from "../updates/macReleaseFeed.ts";
import {
  ElectronUpdater,
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
} from "./ElectronUpdater.ts";

const execFile = promisify(ChildProcess.execFile);
const FETCH_TIMEOUT_MS = 30_000;

function readFeedRepository(): string | null {
  try {
    const yml = FS.readFileSync(Path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1];
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1];
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

async function fetchOk(url: string, accept: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "czcode-mac-updater" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new MacUpdateError("czcode couldn't reach GitHub for updates.", { cause });
  }
  if (!response.ok) {
    throw new MacUpdateError(`GitHub answered ${response.status} to an update request.`);
  }
  return response;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.sync(() => {
  const events = new EventEmitter();
  // .../czcode.app/Contents/MacOS/czcode -> .../czcode.app
  const bundlePath = Path.resolve(Electron.app.getPath("exe"), "../../..");
  const stagingDir = Path.join(Path.dirname(bundlePath), ".czcode-update");
  const failureFile = Path.join(Electron.app.getPath("userData"), "update-failed.txt");

  let latest: MacRelease | null = null;
  let staged: { readonly version: string; readonly appPath: string } | null = null;
  let download: { readonly version: string; readonly promise: Promise<void> } | null = null;
  // After a failed swap, wait for the user to ask before downloading again,
  // so a broken update can't restart the app over and over.
  let autoDownload = true;
  let swapStarted = false;

  const startSwap = (relaunch: boolean) => {
    if (swapStarted || !staged) return;
    swapStarted = true;
    ChildProcess.spawn(
      "/bin/sh",
      [
        "-c",
        MAC_SWAP_SCRIPT,
        "sh",
        String(process.pid),
        bundlePath,
        staged.appPath,
        relaunch ? "1" : "0",
        failureFile,
      ],
      { detached: true, stdio: "ignore" },
    ).unref();
  };
  Electron.app.on("will-quit", () => startSwap(false));

  const fetchAndStage = async (release: MacRelease) => {
    const expected = parseSha256File(
      await (await fetchOk(release.sha256Url, "application/octet-stream")).text(),
    );
    if (!expected) throw new MacUpdateError("The update's checksum file is unreadable.");

    const zipPath = Path.join(OS.tmpdir(), `czcode-${release.version}.zip`);
    const response = await fetchOk(release.zipUrl, "application/octet-stream");
    const total = Number(response.headers.get("content-length")) || release.zipSize;
    const hash = Crypto.createHash("sha256");
    const file = FS.createWriteStream(zipPath);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        if (!file.write(chunk))
          await new Promise<void>((resolve) => file.once("drain", () => resolve()));
        received += chunk.length;
        if (total > 0) events.emit("download-progress", { percent: (received / total) * 100 });
      }
    } catch (cause) {
      throw new MacUpdateError("The update download was cut off.", { cause });
    } finally {
      await new Promise<void>((resolve) => file.end(() => resolve()));
    }
    try {
      if (hash.digest("hex") !== expected) {
        throw new MacUpdateError("The downloaded update didn't match its checksum.");
      }
      try {
        await FSP.rm(stagingDir, { recursive: true, force: true });
        await FSP.mkdir(stagingDir);
      } catch (cause) {
        throw new MacUpdateError(
          `czcode can't write to ${Path.dirname(bundlePath)}, so it can't update itself.`,
          { cause },
        );
      }
      await execFile("ditto", ["-x", "-k", zipPath, stagingDir]).catch((cause: unknown) => {
        throw new MacUpdateError("The downloaded update couldn't be unpacked.", { cause });
      });
      const appName = (await FSP.readdir(stagingDir)).find((name) => name.endsWith(".app"));
      const appPath = appName ? Path.join(stagingDir, appName) : null;
      if (!appPath || !FS.existsSync(Path.join(appPath, "Contents/MacOS"))) {
        throw new MacUpdateError("The downloaded update has no app in it.");
      }
      // curl-style downloads aren't quarantined, but be sure: a quarantined
      // unsigned app won't open.
      await execFile("xattr", ["-dr", "com.apple.quarantine", appPath]).catch(() => undefined);
      staged = { version: release.version, appPath };
      events.emit("update-downloaded", { version: release.version });
    } catch (error) {
      await FSP.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await FSP.rm(zipPath, { force: true }).catch(() => undefined);
    }
  };

  const downloadRelease = (release: MacRelease): Promise<void> => {
    if (staged?.version === release.version) return Promise.resolve();
    if (download?.version === release.version) return download.promise;
    staged = null;
    const promise = fetchAndStage(release).finally(() => {
      if (download?.promise === promise) download = null;
    });
    download = { version: release.version, promise };
    return promise;
  };

  const check = async () => {
    const failure = await FSP.readFile(failureFile, "utf8").catch(() => null);
    if (failure !== null) {
      await FSP.rm(failureFile, { force: true });
      autoDownload = false;
      throw new MacUpdateError(failure.trim() || "The last update couldn't be installed.");
    }
    const repository = readFeedRepository();
    if (!repository) throw new MacUpdateError("This build has no update feed.");
    events.emit("checking-for-update");
    const response = await fetchOk(
      `https://api.github.com/repos/${repository}/releases?per_page=30`,
      "application/vnd.github+json",
    );
    const release = newestMacRelease(await response.json());
    if (!release || release.build <= macBuildNumber(Electron.app.getVersion())) {
      latest = null;
      events.emit("update-not-available");
      return;
    }
    latest = release;
    events.emit("update-available", { version: release.version });
    if (autoDownload && staged?.version !== release.version) {
      downloadRelease(release).catch((error: unknown) => events.emit("error", error));
    }
  };

  return ElectronUpdater.of({
    // This feed has one configuration: it always downloads, installs on quit,
    // and ignores channels (every Mac release is a build of main).
    setFeedURL: () => Effect.void,
    setAutoDownload: () => Effect.void,
    setAutoInstallOnAppQuit: () => Effect.void,
    setChannel: () => Effect.void,
    setAllowPrerelease: () => Effect.void,
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: () => Effect.void,
    setFullChangelog: () => Effect.void,
    setDisableDifferentialDownload: () => Effect.void,
    checkForUpdates: Effect.tryPromise({
      try: check,
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel: null, cause }),
    }),
    downloadUpdate: Effect.tryPromise({
      try: () => {
        autoDownload = true;
        if (!latest) throw new MacUpdateError("There is no update to download.");
        return downloadRelease(latest);
      },
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel: null, cause }),
    }),
    quitAndInstall: ({ isSilent, isForceRunAfter }) =>
      Effect.try({
        try: () => {
          if (!staged || !FS.existsSync(staged.appPath)) {
            staged = null;
            throw new MacUpdateError("The downloaded update is gone; check for updates again.");
          }
          startSwap(true);
          Electron.app.quit();
        },
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel: null,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      }),
    on: (eventName, listener) => {
      const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => events.on(eventName, untypedListener)),
        () => Effect.sync(() => events.removeListener(eventName, untypedListener)),
      ).pipe(Effect.asVoid);
    },
  });
});

export const layer = Layer.effect(ElectronUpdater, make);
