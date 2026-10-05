import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { LEGACY_PROJECT_FILE_NAME } from "@cz/shared/legacyNames";

import * as CzProjectFileLoader from "./CzProjectFileLoader.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(CzProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "czcode-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (
  cwd: string,
  contents: string,
  name: string = "cz.json",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, name), contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("CzProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("loads and decodes a valid cz.json", () =>
      Effect.gen(function* () {
        const loader = yield* CzProjectFileLoader.CzProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          `{
            // JSONC is tolerated
            "iconPath": "assets/logo.svg",
            "scripts": [{ "name": "Dev", "command": "pnpm dev" }],
          }`,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
          expect(loaded.value.iconPath).toBe("assets/logo.svg");
          expect(loaded.value.scripts).toEqual([{ name: "Dev", command: "pnpm dev" }]);
        }
      }),
    );

    it.effect("falls back to the pre-rename project file, and prefers cz.json", () =>
      Effect.gen(function* () {
        const loader = yield* CzProjectFileLoader.CzProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, `{ "iconPath": "legacy.svg" }`, LEGACY_PROJECT_FILE_NAME);

        const legacy = yield* loader.load(cwd);
        expect(Option.map(legacy, (file) => file.iconPath)).toEqual(Option.some("legacy.svg"));

        yield* writeProjectFile(cwd, `{ "iconPath": "current.svg" }`);
        const current = yield* loader.load(cwd);
        expect(Option.map(current, (file) => file.iconPath)).toEqual(Option.some("current.svg"));
      }),
    );

    it.effect("returns none when cz.json is missing", () =>
      Effect.gen(function* () {
        const loader = yield* CzProjectFileLoader.CzProjectFileLoader;
        const cwd = yield* makeTempDir;

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for malformed JSON without failing", () =>
      Effect.gen(function* () {
        const loader = yield* CzProjectFileLoader.CzProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "{ not json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for schema-invalid files without failing", () =>
      Effect.gen(function* () {
        const loader = yield* CzProjectFileLoader.CzProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, '{ "scripts": [{ "name": "Dev" }] }');

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );
  });
});
