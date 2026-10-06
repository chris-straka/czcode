/**
 * `cz tui`: the terminal client, for running in a terminal or a neovim float.
 * Connects to the cz server running on this machine with a session it mints
 * for itself (revoked on exit), plus any machines the TUI has paired with.
 *
 * @module TuiCli
 */
import { AuthStandardClientScopes } from "@cz/contracts";
import type { LocalServer, TuiModule } from "@cz/tui/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as NodeOS from "node:os";

import packageJson from "../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

export class TuiCliError extends Schema.TaggedError<TuiCliError>()("TuiCliError", {
  message: Schema.String,
}) {}

/** `$XDG_CONFIG_HOME/czcode/tui`, else `~/.config/czcode/tui`: saved connections. */
const tuiConfigDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(NodeOS.homedir(), ".config");
  return path.join(base, "czcode", "tui");
});

// Loaded lazily so `cz serve` never pays for Ink and React. The package's
// "types" entry declares only runTui, keeping its DOM-typed client code out
// of the server's type program.
const loadTui = (): Promise<TuiModule> => {
  // A neovim terminal reports TERM=xterm-256color and no COLORTERM, though
  // Ghostty behind it draws truecolor. Set before Ink's colour library loads.
  if (process.env.NVIM && process.env.FORCE_COLOR === undefined) process.env.FORCE_COLOR = "3";
  return import("@cz/tui");
};

export const tuiCommand = Command.make("tui", { baseDir: baseDirFlag }).pipe(
  Command.withDescription("Open the terminal app (threads, decisions, queue) for this machine."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir: flags.baseDir }, logLevel);
      const configDir = yield* tuiConfigDir;
      const { runTui } = yield* Effect.promise(loadTui);
      yield* Effect.gen(function* () {
        const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const run = (local: LocalServer | null) =>
          Effect.tryPromise({
            try: () =>
              runTui({ local, configDir, appVersion: packageJson.version, cwd: process.cwd() }),
            catch: (cause) =>
              new TuiCliError({ message: `The terminal app failed: ${String(cause)}` }),
          });
        if (Option.isNone(runtimeState)) return yield* run(null);
        yield* Effect.acquireUseRelease(
          auth.issueSession({ scopes: AuthStandardClientScopes, label: "cz tui" }),
          (issued) =>
            run({
              httpBaseUrl: runtimeState.value.origin,
              bearerToken: issued.token,
              label: NodeOS.hostname().replace(/\.local$/, ""),
            }),
          (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
        );
      }).pipe(
        Effect.provide(
          EnvironmentAuth.layerRuntime.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provide(ServerConfig.layer(config)),
          ),
        ),
      );
    }),
  ),
);
