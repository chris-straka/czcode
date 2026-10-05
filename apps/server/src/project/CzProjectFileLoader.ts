/**
 * CzProjectFileLoader - Effect service that loads the checked-in `cz.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module CzProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CZ_PROJECT_FILE_NAME, type CzProjectFile } from "@cz/contracts";
import { CzProjectFileFromJson } from "@cz/shared/czProjectFile";
import { LEGACY_PROJECT_FILE_NAME } from "@cz/shared/legacyNames";

const decodeCzProjectFileJson = Schema.decodeEffect(CzProjectFileFromJson);

export class CzProjectFileLoadError extends Schema.TaggedError<CzProjectFileLoadError>()(
  "CzProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${CZ_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for cz.json project file loading. */
export class CzProjectFileLoader extends Context.Service<
  CzProjectFileLoader,
  {
    /**
     * Load and decode `cz.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<CzProjectFile>>;
  }
>()("cz/project/CzProjectFileLoader") {}

const logCzProjectFileLoadError = (error: CzProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: CzProjectFileLoader["Service"]["load"] = Effect.fn("CzProjectFileLoader.load")(
    function* (workspaceRoot) {
      // Repos set up before the rename still carry the old project file name.
      const current = path.join(workspaceRoot, CZ_PROJECT_FILE_NAME);
      const legacy = path.join(workspaceRoot, LEGACY_PROJECT_FILE_NAME);
      const filePath =
        !(yield* fileSystem.exists(current).pipe(Effect.orElseSucceed(() => true))) &&
        (yield* fileSystem.exists(legacy).pipe(Effect.orElseSucceed(() => false)))
          ? legacy
          : current;
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logCzProjectFileLoadError(
                  new CzProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<CzProjectFile>();
      }
      return yield* decodeCzProjectFileJson(raw.value).pipe(
        Effect.asSome,
        Effect.catchTags({
          SchemaError: (error) =>
            logCzProjectFileLoadError(
              new CzProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<CzProjectFile>())),
        }),
      );
    },
  );

  return CzProjectFileLoader.of({ load });
});

export const layer = Layer.effect(CzProjectFileLoader, make);
