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
import { Command, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
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

// A runtime specifier keeps the client (and its DOM-typed code) out of the
// server's type program; `@cz/tui/api` carries the contract instead.
const TUI_MODULE = "@cz/tui";
const loadTui = () => import(TUI_MODULE) as Promise<TuiModule>;

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
          EnvironmentAuth.runtimeLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provide(ServerConfig.layer(config)),
          ),
        ),
      );
    }),
  ),
);
