import { BearerConnectionTarget } from "@cz/client-runtime/connection";
import * as CatalogFile from "@cz/client-runtime/platform/catalog-file";
import { EnvironmentId } from "@cz/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

const target = (id: string) =>
  new BearerConnectionTarget({
    environmentId: EnvironmentId.make(id),
    label: id,
    connectionId: `bearer:${id}`,
  });

const configDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "cz-catalog-" });
});

describe("shared machine list file", () => {
  it.live("two apps on one computer see each other's machines without losing any", () =>
    Effect.gen(function* () {
      const dir = yield* configDir;
      const terminal = yield* CatalogFile.openInConfigDir(dir);
      const desktop = yield* CatalogFile.openInConfigDir(dir);
      // Both read before either writes, the way two running apps hold the list.
      yield* terminal.read;
      yield* desktop.read;
      yield* Effect.all(
        [
          terminal.update((doc) => ({ ...doc, targets: [...doc.targets, target("basement")] })),
          desktop.update((doc) => ({ ...doc, targets: [...doc.targets, target("z")] })),
        ],
        { concurrency: "unbounded" },
      );
      const seen = (yield* terminal.read).targets.map((entry) => entry.environmentId).toSorted();
      expect(seen).toEqual(["basement", "z"]);
      expect((yield* desktop.read).targets).toHaveLength(2);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("tells an app when another one changed the list", () =>
    Effect.gen(function* () {
      const dir = yield* configDir;
      const terminal = yield* CatalogFile.openInConfigDir(dir);
      const desktop = yield* CatalogFile.openInConfigDir(dir);
      yield* desktop.read;
      const noticed = yield* desktop.changes.pipe(
        Stream.take(1),
        Stream.runDrain,
        Effect.forkScoped,
      );
      yield* terminal.update((doc) => ({ ...doc, targets: [target("f-ms-7917")] }));
      yield* TestClock.adjust("3 seconds");
      yield* Fiber.join(noticed);
      expect((yield* desktop.read).targets.map((entry) => entry.label)).toEqual(["f-ms-7917"]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("starts from the terminal app's old list, written with owner-only access", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* configDir;
      const old = yield* CatalogFile.make(path.join(dir, "tui", "connections.json"));
      yield* old.update((doc) => ({ ...doc, targets: [target("basement")] }));

      const shared = yield* CatalogFile.openInConfigDir(dir);
      expect((yield* shared.read).targets.map((entry) => entry.label)).toEqual(["basement"]);
      yield* shared.update((doc) => doc);
      const info = yield* fs.stat(path.join(dir, "connections.json"));
      expect(info.mode & 0o777).toBe(0o600);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
