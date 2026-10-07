/**
 * The machine list one computer shares: client-runtime's connection catalog
 * document as one JSON file (mode 600, it holds bearer tokens). The terminal
 * app, the `cz host` and `--host` CLI, the desktop app, and the local cz
 * server all read and write the same file, so a machine paired in one shows up
 * in all of them. Each computer still has its own tokens, so one can be
 * revoked alone.
 *
 * Several processes write it, so every update takes a lock file, re-reads the
 * document from disk, applies its change, and replaces the file atomically.
 * `changes` notices writes from other processes.
 *
 * @module catalogFile
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ConnectionTransientError } from "../connection/model.ts";
import { ConnectionCatalogDocument, EMPTY_CONNECTION_CATALOG_DOCUMENT } from "./storageDocument.ts";

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

/** The shared file's name inside the czcode config directory. */
export const CATALOG_FILE_NAME = "connections.json";

const LOCK_RETRY = Duration.millis(25);
const LOCK_TIMEOUT = Duration.seconds(5);
// A writer holds the lock for milliseconds; an older lock outlived a crash.
const STALE_LOCK_MS = 10_000;
const CHANGE_POLL = Duration.seconds(2);

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the saved machine list: ${String(cause)}`,
  });
}

export interface CatalogFile {
  readonly path: string;
  readonly read: Effect.Effect<ConnectionCatalogDocument, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocument) => ConnectionCatalogDocument,
  ) => Effect.Effect<void, ConnectionTransientError>;
  /** Emits after another process changed the file. */
  readonly changes: Stream.Stream<void>;
}

interface Snapshot {
  readonly stamp: string;
  readonly document: ConnectionCatalogDocument;
}

/**
 * Opens the catalog at `file`. When it doesn't exist yet and `legacyFiles`
 * does, the first of those is copied in (it is left in place).
 */
export const make = Effect.fn("catalogFile.make")(function* (
  file: string,
  options?: { readonly legacyFiles?: ReadonlyArray<string> },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(file);
  const lockFile = `${file}.lock`;
  const cache = yield* Ref.make<Option.Option<Snapshot>>(Option.none());
  const lock = yield* Semaphore.make(1);

  // Every write renames a new file into place, so the inode alone changes on
  // each version; mtime and size cover file systems without inodes.
  const stampOf = fs.stat(file).pipe(
    Effect.map(
      (info) =>
        `${Option.getOrUndefined(info.ino) ?? 0}:${Option.getOrUndefined(info.mtime)?.getTime() ?? 0}:${info.size}`,
    ),
    Effect.orElseSucceed(() => "missing"),
  );

  const decodeOrEmpty = (raw: string) =>
    decodeCatalog(raw).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ignoring an unreadable saved machine list.", { file, cause }).pipe(
          Effect.as(EMPTY_CONNECTION_CATALOG_DOCUMENT),
        ),
      ),
    );

  const migrateLegacy = Effect.gen(function* () {
    for (const legacy of options?.legacyFiles ?? []) {
      if (!(yield* fs.exists(legacy).pipe(Effect.orElseSucceed(() => false)))) continue;
      const raw = yield* fs.readFileString(legacy);
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      // "wx": another process may have created the file meanwhile; keep theirs.
      yield* fs.writeFileString(file, raw, { flag: "wx", mode: 0o600 }).pipe(Effect.ignore);
      return;
    }
  }).pipe(
    Effect.catch((cause) => Effect.logWarning("Could not copy the old machine list.", { cause })),
  );

  const loadFresh = Effect.gen(function* () {
    let stamp = yield* stampOf;
    if (stamp === "missing" && options?.legacyFiles?.length) {
      yield* migrateLegacy;
      stamp = yield* stampOf;
    }
    const cached = yield* Ref.get(cache);
    if (Option.isSome(cached) && cached.value.stamp === stamp) return cached.value.document;
    const document =
      stamp === "missing"
        ? EMPTY_CONNECTION_CATALOG_DOCUMENT
        : yield* fs.readFileString(file).pipe(
            Effect.flatMap(decodeOrEmpty),
            Effect.orElseSucceed(() => EMPTY_CONNECTION_CATALOG_DOCUMENT),
          );
    yield* Ref.set(cache, Option.some({ stamp, document }));
    return document;
  });

  const acquireFileLock = Effect.gen(function* () {
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(LOCK_TIMEOUT);
    while (true) {
      const taken = yield* fs.writeFileString(lockFile, "", { flag: "wx" }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (taken) return;
      const now = yield* Clock.currentTimeMillis;
      const age = yield* fs.stat(lockFile).pipe(
        Effect.map((info) => now - (Option.getOrUndefined(info.mtime)?.getTime() ?? now)),
        Effect.orElseSucceed(() => 0),
      );
      if (age > STALE_LOCK_MS || now > deadline) {
        yield* fs.remove(lockFile, { force: true }).pipe(Effect.ignore);
        continue;
      }
      yield* Effect.sleep(LOCK_RETRY);
    }
  });
  const releaseFileLock = fs.remove(lockFile, { force: true }).pipe(Effect.ignore);

  const read = lock.withPermits(1)(loadFresh);

  const update: CatalogFile["update"] = (transform) =>
    lock.withPermits(1)(
      Effect.acquireUseRelease(
        acquireFileLock,
        () =>
          Effect.gen(function* () {
            // Re-read under the file lock so another process's change survives.
            const next = transform(yield* loadFresh);
            const encoded = yield* encodeCatalog(next);
            const partial = `${file}.${yield* Random.nextIntBetween(0, 1e9)}.partial`;
            yield* fs.writeFileString(partial, encoded, { mode: 0o600 });
            yield* fs.rename(partial, file);
            yield* Ref.set(cache, Option.some({ stamp: yield* stampOf, document: next }));
          }),
        () => releaseFileLock,
      ).pipe(Effect.mapError((cause) => catalogError("save", cause))),
    );

  const changes: Stream.Stream<void> = Stream.fromEffectRepeat(
    Effect.gen(function* () {
      yield* Effect.sleep(CHANGE_POLL);
      const stamp = yield* stampOf;
      const cached = yield* Ref.get(cache);
      return Option.isSome(cached) && cached.value.stamp !== stamp;
    }),
  ).pipe(
    Stream.filter((changed) => changed),
    Stream.mapEffect(() => read.pipe(Effect.ignore)),
  );

  return {
    path: file,
    read: read.pipe(Effect.mapError((cause) => catalogError("read", cause))),
    update,
    changes,
  } satisfies CatalogFile;
});

/**
 * The computer's shared machine list in czcode's config directory
 * (`$XDG_CONFIG_HOME/czcode`, else `~/.config/czcode`). The terminal app kept
 * it under `tui/` before every app shared it; that copy seeds the first read.
 */
export const openInConfigDir = Effect.fn("catalogFile.openInConfigDir")(function* (
  configDir: string,
) {
  const path = yield* Path.Path;
  return yield* make(path.join(configDir, CATALOG_FILE_NAME), {
    legacyFiles: [path.join(configDir, "tui", CATALOG_FILE_NAME)],
  });
});
