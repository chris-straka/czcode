import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@cz/client-runtime/connection";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@cz/client-runtime/platform";
import * as CatalogFile from "@cz/client-runtime/platform/catalog-file";
import { EnvironmentId } from "@cz/contracts";
import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopConnectionCatalogStore from "./DesktopConnectionCatalogStore.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

const layerSafeStorage = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
  isEncryptionAvailable: Effect.succeed(true),
  encryptString: (value) => Effect.succeed(textEncoder.encode(`encrypted:${value}`)),
  decryptString: (value) => Effect.succeed(textDecoder.decode(value).slice("encrypted:".length)),
  selectedStorageBackend: Effect.succeedNone,
} satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);

const layerWindow = Layer.succeed(ElectronWindow.ElectronWindow, {
  create: () => Effect.die("unexpected BrowserWindow creation"),
  main: Effect.succeedNone,
  currentMainOrFirst: Effect.succeedNone,
  focusedMainOrFirst: Effect.succeedNone,
  setMain: () => Effect.void,
  clearMain: () => Effect.void,
  prepareReveal: () => Effect.succeed(false),
  reveal: () => Effect.void,
  sendAll: () => Effect.void,
  destroyAll: Effect.void,
  syncAllAppearance: () => Effect.void,
} satisfies ElectronWindow.ElectronWindow["Service"]);

function machine(id: string, token: string) {
  const environmentId = EnvironmentId.make(id);
  const connectionId = `bearer:${id}:https://${id}.example.ts.net`;
  return {
    target: new BearerConnectionTarget({ environmentId, label: id, connectionId }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId,
      label: id,
      httpBaseUrl: `https://${id}.example.ts.net/`,
      wsBaseUrl: `wss://${id}.example.ts.net/`,
    }),
    credential: { connectionId, credential: new BearerConnectionCredential({ token }) },
  };
}

function catalogOf(...machines: ReadonlyArray<ReturnType<typeof machine>>) {
  return {
    ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
    targets: machines.map((entry) => entry.target),
    profiles: machines.map((entry) => entry.profile),
    credentials: machines.map((entry) => entry.credential),
  };
}

/** A packaged desktop app whose home is a temp directory. */
const withHome = <A, E, R>(
  run: (paths: {
    readonly stateDir: string;
    readonly sharedFile: string;
    readonly start: Layer.Layer<
      DesktopConnectionCatalogStore.DesktopConnectionCatalogStore,
      Config.ConfigError
    >;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cz-desktop-machines-" });
    const layerEnvironment = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: home,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "1.2.3",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({ CZ_HOME: path.join(home, ".cz") }),
        ),
      ),
    );
    const dependencies = Layer.mergeAll(
      layerEnvironment,
      layerSafeStorage,
      layerWindow,
      NodeServices.layer,
    );
    const start = DesktopConnectionCatalogStore.layer.pipe(
      Layer.provide(DesktopSavedEnvironments.layer.pipe(Layer.provideMerge(dependencies))),
      Layer.provide(dependencies),
    );
    return yield* run({
      stateDir: path.join(home, ".cz", "userdata"),
      // Same place the terminal app and `cz host` use on this computer.
      sharedFile: path.join(home, ".config", "czcode", "connections.json"),
      start,
    });
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const writeOldEncryptedList = (stateDir: string, catalog: ConnectionCatalogDocument) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    const encrypted = textEncoder.encode(`encrypted:${yield* encodeCatalog(catalog)}`);
    yield* fileSystem.writeFileString(
      `${stateDir}/connection-catalog.json`,
      JSON.stringify({ version: 1, encryptedCatalog: Base64.encode(encrypted) }),
    );
  });

const savedLabels = (
  store: DesktopConnectionCatalogStore.DesktopConnectionCatalogStore["Service"],
) =>
  store.get.pipe(
    Effect.flatMap((raw) => decodeCatalog(Option.getOrThrow(raw))),
    Effect.map((catalog) => catalog.targets.map((target) => target.label)),
  );

describe("DesktopConnectionCatalogStore", () => {
  it.effect("shares one machine list with the terminal app and the CLI", () =>
    withHome(({ sharedFile, start }) =>
      Effect.gen(function* () {
        const terminal = yield* CatalogFile.make(sharedFile);
        yield* terminal.update(() => catalogOf(machine("basement", "terminal-token")));

        yield* Effect.gen(function* () {
          const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
          assert.deepEqual(yield* savedLabels(store), ["basement"]);

          const both = catalogOf(machine("basement", "terminal-token"), machine("z", "t"));
          assert.isTrue(yield* store.set(yield* encodeCatalog(both)));
        }).pipe(Effect.provide(start));

        const seen = (yield* terminal.read).targets.map((target) => target.label);
        assert.deepEqual(seen, ["basement", "z"]);
        const info = yield* (yield* FileSystem.FileSystem).stat(sharedFile);
        assert.equal(info.mode & 0o777, 0o600);
      }),
    ),
  );

  it.effect("moves the old encrypted list in once, keeping machines already shared", () =>
    withHome(({ stateDir, sharedFile, start }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const terminal = yield* CatalogFile.make(sharedFile);
        yield* terminal.update(() => catalogOf(machine("basement", "terminal-token")));
        yield* writeOldEncryptedList(
          stateDir,
          catalogOf(machine("basement", "old-desktop-token"), machine("z", "desktop-token")),
        );

        yield* Effect.gen(function* () {
          const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
          const catalog = yield* decodeCatalog(Option.getOrThrow(yield* store.get));
          assert.deepEqual(
            catalog.targets.map((target) => target.label),
            ["basement", "z"],
          );
          // basement was already shared, so its token is the terminal's.
          assert.deepEqual(
            catalog.credentials.map((entry) => entry.credential.token),
            ["terminal-token", "desktop-token"],
          );
          // The user removes z; the old list must not bring it back.
          yield* store.set(yield* encodeCatalog(catalogOf(machine("basement", "terminal-token"))));
        }).pipe(Effect.provide(start));

        assert.isFalse(yield* fileSystem.exists(`${stateDir}/connection-catalog.json`));
        assert.isTrue(yield* fileSystem.exists(`${stateDir}/connection-catalog.json.migrated`));

        const restarted = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore.pipe(
          Effect.flatMap(savedLabels),
          Effect.provide(start),
        );
        assert.deepEqual(restarted, ["basement"]);
      }),
    ),
  );
});
