/**
 * The TUI's saved connections: client-runtime's connection catalog document,
 * kept as one JSON file (mode 600, it holds bearer tokens) in the TUI's config
 * directory. Same document the mobile app keeps in secure storage.
 *
 * @module catalogFile
 */
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@cz/client-runtime/platform";
import { ConnectionTransientError } from "@cz/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the TUI connection catalog: ${String(cause)}`,
  });
}

export interface CatalogFile {
  readonly read: Effect.Effect<ConnectionCatalogDocument, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocument) => ConnectionCatalogDocument,
  ) => Effect.Effect<void, ConnectionTransientError>;
}

export const make = Effect.fn("tui.catalogFile.make")(function* (configDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(configDir, "connections.json");
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocument>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const loadUnlocked = Effect.gen(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) return cached.value;
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    const catalog = exists
      ? yield* fs.readFileString(file).pipe(
          Effect.flatMap((raw) => decodeCatalog(raw)),
          Effect.catch((cause) =>
            Effect.logWarning("Discarding an unreadable TUI connection catalog.", { cause }).pipe(
              Effect.as(EMPTY_CONNECTION_CATALOG_DOCUMENT),
            ),
          ),
        )
      : EMPTY_CONNECTION_CATALOG_DOCUMENT;
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(loadUnlocked);
  const update: CatalogFile["update"] = (transform) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = transform(yield* loadUnlocked);
        const encoded = yield* encodeCatalog(next).pipe(
          Effect.mapError((cause) => catalogError("encode", cause)),
        );
        yield* fs.makeDirectory(configDir, { recursive: true, mode: 0o700 });
        const partial = `${file}.partial`;
        yield* fs.writeFileString(partial, encoded, { mode: 0o600 });
        yield* fs.rename(partial, file);
        yield* Ref.set(state, Option.some(next));
      }).pipe(Effect.mapError((cause) => catalogError("save", cause))),
    );

  return { read, update } satisfies CatalogFile;
});
