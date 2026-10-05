/**
 * The newest Android release APK on this machine, offered to paired phones so
 * they update from the owner's own server instead of a store.
 * `ccez/release/android.sh --publish` drops `czcode-<version>-<versionCode>.apk`
 * into `<base dir>/releases/android/`.
 *
 * @module MobileReleaseService
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

const APK_NAME = /^czcode-(.+)-(\d+)\.apk$/;

export interface AndroidApk {
  readonly file: string;
  readonly version: string;
  readonly versionCode: number;
  readonly sizeBytes: number;
}

/** Reads a published APK's version from its file name, or null for any other file. */
export function parseApkName(file: string): Pick<AndroidApk, "version" | "versionCode"> | null {
  const match = APK_NAME.exec(file);
  return match?.[1] && match[2] ? { version: match[1], versionCode: Number(match[2]) } : null;
}

export class MobileReleaseService extends Context.Service<
  MobileReleaseService,
  {
    /** The published APK with the highest versionCode, if any. */
    readonly latestAndroid: Effect.Effect<Option.Option<AndroidApk>>;
    /** The path of a published APK by file name; none for anything else. */
    readonly androidPath: (file: string) => Effect.Effect<Option.Option<string>>;
  }
>()("cz/mobileRelease/MobileReleaseService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(config.baseDir, "releases", "android");

  const androidPath: MobileReleaseService["Service"]["androidPath"] = (file) =>
    parseApkName(file) === null
      ? Effect.succeedNone
      : fs.exists(path.join(dir, file)).pipe(
          Effect.map((exists) => (exists ? Option.some(path.join(dir, file)) : Option.none())),
          Effect.orElseSucceed(() => Option.none()),
        );

  const latestAndroid = Effect.gen(function* () {
    const files = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
    let best: { file: string; version: string; versionCode: number } | null = null;
    for (const file of files) {
      const parsed = parseApkName(file);
      if (parsed && (best === null || parsed.versionCode > best.versionCode)) {
        best = { file, ...parsed };
      }
    }
    if (best === null) return Option.none<AndroidApk>();
    const latest = best;
    return yield* fs.stat(path.join(dir, latest.file)).pipe(
      Effect.map((info) => Option.some({ ...latest, sizeBytes: Number(info.size) })),
      Effect.orElseSucceed(() => Option.none<AndroidApk>()),
    );
  });

  return MobileReleaseService.of({ latestAndroid, androidPath });
});

export const layer = Layer.effect(MobileReleaseService, make);
