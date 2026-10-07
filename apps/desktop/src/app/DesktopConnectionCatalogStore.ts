/**
 * The desktop app's saved machines: the computer's shared machine list
 * (`@cz/client-runtime/platform/catalog-file`), which the terminal app, the
 * `cz host` CLI, and the local server use too. The renderer reads and writes
 * the whole document over IPC and is told when another app changed it.
 *
 * Older desktop builds kept their own list, encrypted with Electron safe
 * storage in `<stateDir>/connection-catalog.json`, and before that in
 * `saved-environments.json`. On first start those machines are added to the
 * shared list (machines already there keep their records) and the encrypted
 * file is renamed `.migrated`, so a machine removed later never comes back.
 *
 * @module DesktopConnectionCatalogStore
 */
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
} from "@cz/client-runtime/connection";
import {
  addMissingEnvironmentsToCatalog,
  ConnectionCatalogDocument as RuntimeConnectionCatalogDocument,
  type ConnectionCatalogDocument as RuntimeConnectionCatalogDocumentType,
} from "@cz/client-runtime/platform";
import * as CatalogFile from "@cz/client-runtime/platform/catalog-file";
import type { PersistedSavedEnvironmentRecord } from "@cz/contracts";
import { fromLenientJson } from "@cz/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const EncryptedConnectionCatalogDocument = Schema.Struct({
  version: Schema.Literal(1),
  encryptedCatalog: Schema.String,
});
const decodeEncryptedDocument = Schema.decodeEffect(
  fromLenientJson(EncryptedConnectionCatalogDocument),
);
const CatalogJson = Schema.fromJsonString(RuntimeConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

export class DesktopConnectionCatalogStoreError extends Schema.TaggedError<DesktopConnectionCatalogStoreError>()(
  "DesktopConnectionCatalogStoreError",
  {
    operation: Schema.Literals(["read", "write"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not ${this.operation} the saved machine list at ${this.path}.`;
  }
}

export class DesktopConnectionCatalogStore extends Context.Service<
  DesktopConnectionCatalogStore,
  {
    readonly path: string;
    readonly get: Effect.Effect<Option.Option<string>, DesktopConnectionCatalogStoreError>;
    readonly set: (catalog: string) => Effect.Effect<boolean, DesktopConnectionCatalogStoreError>;
  }
>()("@cz/desktop/app/DesktopConnectionCatalogStore") {}

function connectionId(prefix: "bearer" | "ssh", environmentId: string): string {
  return `${prefix}:${environmentId}`;
}

const migrateSavedEnvironmentRecords = Effect.fn(
  "desktop.connectionCatalogStore.migrateSavedEnvironmentRecords",
)(function* (
  records: readonly PersistedSavedEnvironmentRecord[],
  savedEnvironments: DesktopSavedEnvironments.DesktopSavedEnvironments["Service"],
) {
  const targets: Array<RuntimeConnectionCatalogDocumentType["targets"][number]> = [];
  const profiles: Array<RuntimeConnectionCatalogDocumentType["profiles"][number]> = [];
  const credentials: Array<RuntimeConnectionCatalogDocumentType["credentials"][number]> = [];

  for (const record of records) {
    if (record.relayManaged !== undefined) {
      targets.push(
        new RelayConnectionTarget({
          environmentId: record.environmentId,
          label: record.label,
        }),
      );
      continue;
    }

    if (record.desktopSsh !== undefined) {
      const id = connectionId("ssh", record.environmentId);
      targets.push(
        new SshConnectionTarget({
          environmentId: record.environmentId,
          label: record.label,
          connectionId: id,
        }),
      );
      profiles.push(
        new SshConnectionProfile({
          connectionId: id,
          environmentId: record.environmentId,
          label: record.label,
          target: record.desktopSsh,
        }),
      );
      continue;
    }

    const id = connectionId("bearer", record.environmentId);
    targets.push(
      new BearerConnectionTarget({
        environmentId: record.environmentId,
        label: record.label,
        connectionId: id,
      }),
    );
    profiles.push(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: record.environmentId,
        label: record.label,
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
      }),
    );
    const token = yield* savedEnvironments.getSecret(record.environmentId);
    if (Option.isSome(token)) {
      credentials.push({
        connectionId: id,
        credential: new BearerConnectionCredential({ token: token.value }),
      });
    }
  }

  return {
    schemaVersion: 1 as const,
    targets,
    profiles,
    credentials,
    remoteDpopTokens: [],
    disabledEnvironmentIds: [],
  };
});

interface OldDesktopList {
  readonly catalog: RuntimeConnectionCatalogDocumentType;
  /** Marks the old list moved, so it is never added again. */
  readonly retire: Effect.Effect<void, PlatformError.PlatformError>;
}

/** The machines an older desktop build saved, or nothing once they were moved. */
const readOldDesktopList = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
  const encryptedPath = environment.path.join(environment.stateDir, "connection-catalog.json");
  const migratedPath = `${encryptedPath}.migrated`;

  if (yield* fileSystem.exists(migratedPath)) return Option.none<OldDesktopList>();
  if (!(yield* safeStorage.isEncryptionAvailable)) return Option.none<OldDesktopList>();
  if (yield* fileSystem.exists(encryptedPath)) {
    const raw = yield* fileSystem.readFileString(encryptedPath);
    const document = yield* decodeEncryptedDocument(raw);
    const encrypted = yield* Effect.fromResult(Base64.decode(document.encryptedCatalog));
    const catalog = yield* decodeCatalog(yield* safeStorage.decryptString(encrypted));
    return Option.some<OldDesktopList>({
      catalog,
      retire: fileSystem.rename(encryptedPath, migratedPath),
    });
  }
  const records = yield* savedEnvironments.getRegistry;
  if (records.length === 0) return Option.none<OldDesktopList>();
  const catalog = yield* migrateSavedEnvironmentRecords(records, savedEnvironments);
  // Marks the move so the old registry isn't read again.
  return Option.some<OldDesktopList>({
    catalog,
    retire: fileSystem.writeFileString(migratedPath, ""),
  });
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const file = yield* CatalogFile.openInConfigDir(environment.machineListDir);

  yield* readOldDesktopList.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: ({ catalog, retire }) =>
          file
            .update((shared) => addMissingEnvironmentsToCatalog(shared, catalog))
            .pipe(
              Effect.andThen(retire),
              Effect.tap(() =>
                Effect.logInfo("Moved the desktop's saved machines to the shared list.", {
                  path: file.path,
                  machines: catalog.targets.length,
                }),
              ),
            ),
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Could not move the desktop's old saved machines.", { cause }),
    ),
  );

  yield* file.changes.pipe(
    Stream.runForEach(() => electronWindow.sendAll(IpcChannels.CONNECTION_CATALOG_CHANGED_CHANNEL)),
    Effect.forkScoped,
  );

  return DesktopConnectionCatalogStore.of({
    path: file.path,
    get: file.read.pipe(
      Effect.flatMap(encodeCatalog),
      Effect.map(Option.some),
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreError({ operation: "read", path: file.path, cause }),
      ),
    ),
    set: (raw) =>
      decodeCatalog(raw).pipe(
        Effect.flatMap((catalog) => file.update(() => catalog)),
        Effect.as(true),
        Effect.mapError(
          (cause) =>
            new DesktopConnectionCatalogStoreError({ operation: "write", path: file.path, cause }),
        ),
      ),
  });
});

export const layer = Layer.effect(DesktopConnectionCatalogStore, make);
