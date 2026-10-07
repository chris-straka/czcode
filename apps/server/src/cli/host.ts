/**
 * `cz host`: the machine list. The machines saved on this computer (shared
 * with the terminal app, the desktop app, and `--host` on other commands),
 * and with a running server, the cz servers it found on the tailnet.
 *
 * @module HostCli
 */
import type { Machine } from "@cz/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import { findMachine } from "../machines/machines.ts";
import { baseDirFlag } from "./config.ts";
import { loadHosts, machineListDir, withServer } from "./serverClient.ts";

export class HostCliError extends Schema.TaggedError<HostCliError>()("HostCliError", {
  message: Schema.String,
}) {}

const hostsCall = <A>(what: string, use: (configDir: string) => Promise<A>) =>
  machineListDir.pipe(
    Effect.flatMap((configDir) =>
      Effect.tryPromise({
        try: () => use(configDir),
        catch: (cause) =>
          new HostCliError({
            message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      }),
    ),
  );

const localSession = (baseDir: Option.Option<string>) => ({
  baseDir,
  host: Option.none<string>(),
  sessionLabel: "cz host cli",
});

export const describeMachine = (machine: Machine) => {
  const state = machine.self
    ? "this machine"
    : !machine.signedIn
      ? "not signed in"
      : machine.online
        ? "signed in"
        : "signed in, not answering";
  return `${machine.label}  ${machine.httpBaseUrl}  (${state})`;
};

const listCommand = Command.make("list", {
  baseDir: baseDirFlag,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription(
    "Machines on the tailnet: this one, the ones this computer is signed in to, and cz servers it found.",
  ),
  Command.withHandler((flags) =>
    withServer(localSession(flags.baseDir), ({ client, headers }) =>
      client.machines.list({ headers }),
    ).pipe(
      Effect.map((result) => result.machines),
      // Without a running server, the saved machines are still worth showing.
      Effect.catch(() =>
        hostsCall("Could not read saved machines", async (configDir) =>
          (await loadHosts()).listHosts(configDir),
        ).pipe(
          Effect.map((hosts) =>
            hosts.map((host): Machine => ({
              environmentId: host.environmentId as Machine["environmentId"],
              label: host.label,
              httpBaseUrl: host.httpBaseUrl,
              online: false,
              signedIn: true,
              self: false,
            })),
          ),
        ),
      ),
      Effect.flatMap((machines) =>
        Console.log(
          flags.json
            ? JSON.stringify(machines, null, 2)
            : machines.length === 0
              ? "No machines yet. Pair one with cz host add <link from `cz pair --tailscale` on it>."
              : machines.map(describeMachine).join("\n"),
        ),
      ),
    ),
  ),
);

const addCommand = Command.make("add", {
  baseDir: baseDirFlag,
  machine: Argument.String("machine").pipe(
    Argument.withDescription(
      "A machine from `cz host list`, or the pairing link from `cz pair --tailscale` on it.",
    ),
  ),
}).pipe(
  Command.withDescription(
    "Sign this computer in to a machine, for the terminal app, the desktop app, and --host.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const wanted = flags.machine.trim();
      const paired = /^https?:\/\//.test(wanted)
        ? yield* hostsCall("Pairing failed", async (configDir) =>
            (await loadHosts()).pairHost({
              configDir,
              pairingUrl: wanted,
              appVersion: packageJson.version,
            }),
          )
        : // By name: the local server asks a machine it is signed in to for a link.
          yield* withServer(localSession(flags.baseDir), ({ client, headers }) =>
            client.machines.pair({ headers, payload: { machine: wanted } }),
          ).pipe(
            Effect.mapError(
              (error) =>
                new HostCliError({
                  message: "message" in error ? String(error.message) : String(error),
                }),
            ),
          );
      yield* Console.log(`Signed in to ${paired.label}.`);
    }),
  ),
);

const removeCommand = Command.make("remove", {
  machine: Argument.String("machine").pipe(
    Argument.withDescription("A machine from `cz host list`."),
  ),
}).pipe(
  Command.withDescription(
    "Forget a machine on this computer. Revoke this computer's access in that machine's Settings > Connections.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const hosts = yield* hostsCall("Could not read saved machines", async (configDir) =>
        (await loadHosts()).listHosts(configDir),
      );
      const host = findMachine(hosts, flags.machine);
      if (!host) {
        return yield* new HostCliError({
          message: `This computer has no machine called ${flags.machine}.`,
        });
      }
      yield* hostsCall("Could not forget the machine", async (configDir) =>
        (await loadHosts()).removeHost(configDir, host.environmentId),
      );
      yield* Console.log(`Forgot ${host.label}.`);
    }),
  ),
);

export const hostCommand = Command.make("host").pipe(
  Command.withDescription("The machines on the tailnet, and which this computer is signed in to."),
  Command.withSubcommands([listCommand, addCommand, removeCommand]),
);
