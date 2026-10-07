/**
 * How `cz` commands reach a server: the one running on this machine, with a
 * short-lived admin session, or with `--host` a machine this terminal has
 * paired with (the TUI's saved connections), over its own address.
 *
 * @module CliServerClient
 */
import { AuthAdministrativeScopes, EnvironmentHttpApi } from "@cz/contracts";
import type { HostsModule, PairedHost } from "@cz/tui/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as NodeOS from "node:os";
import { czConfigDir } from "@cz/shared/configDir";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { findMachine } from "../machines/machines.ts";
import { resolveCliAuthConfig } from "./config.ts";

export class ServerClientError extends Schema.TaggedError<ServerClientError>()(
  "ServerClientError",
  { message: Schema.String },
) {}

export type ServerClient = HttpApiClient.ForApi<typeof EnvironmentHttpApi>;

export interface ServerAccess {
  readonly client: ServerClient;
  readonly headers: { readonly authorization: string };
  /** The machine's name, for messages: this one's hostname or the paired label. */
  readonly label: string;
}

export const hostFlag = Flag.String("host").pipe(
  Flag.withDescription(
    "Act on a machine this terminal has paired with (see `cz host list`) instead of this one.",
  ),
  Flag.optional,
);

/** Where this computer's shared machine list lives (see `@cz/shared/configDir`). */
export const machineListDir = Effect.sync(() => czConfigDir());

// Loaded lazily, and typed by its own entry, so client-runtime stays out of
// `cz serve` and of the server's type program.
export const loadHosts = (): Promise<HostsModule> => import("@cz/tui/hosts");

/** A paired host by its label, environment id, or address. */
export const findHost = findMachine<PairedHost>;

const remoteAccess = (wanted: string) =>
  Effect.gen(function* () {
    const configDir = yield* machineListDir;
    const hosts = yield* Effect.tryPromise({
      try: async () => (await loadHosts()).listHosts(configDir),
      catch: (cause) =>
        new ServerClientError({ message: `Could not read the paired machines: ${String(cause)}` }),
    });
    const host = findHost(hosts, wanted);
    if (!host) {
      const known = hosts.map((entry) => entry.label).join(", ") || "none yet";
      return yield* new ServerClientError({
        message: `No paired machine called ${wanted} (paired: ${known}). Sign in to one with cz host add <name or link>.`,
      });
    }
    const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: host.httpBaseUrl });
    return {
      client,
      headers: { authorization: `Bearer ${host.bearerToken}` },
      label: host.label,
    } satisfies ServerAccess;
  }).pipe(Effect.provide(FetchHttpClient.layer));

/** Runs `run` against this machine's server, or the paired `host`. */
export const withServer = <A, E, R>(
  input: {
    readonly baseDir: Option.Option<string>;
    readonly host: Option.Option<string>;
    /** Names the admin session minted on this machine. */
    readonly sessionLabel: string;
  },
  run: (access: ServerAccess) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (Option.isSome(input.host)) {
      return yield* run(yield* remoteAccess(input.host.value));
    }
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig({ baseDir: input.baseDir }, logLevel);
    return yield* Effect.gen(function* () {
      const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
      if (Option.isNone(runtimeState)) {
        return yield* new ServerClientError({
          message: "cz isn't running. Start it (cz or the desktop app), then try again.",
        });
      }
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
        baseUrl: runtimeState.value.origin,
      });
      return yield* Effect.acquireUseRelease(
        auth.issueSession({ scopes: AuthAdministrativeScopes, label: input.sessionLabel }),
        (issued) =>
          run({
            client,
            headers: { authorization: `Bearer ${issued.token}` },
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
  });
