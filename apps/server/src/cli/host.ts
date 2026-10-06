/**
 * `cz host`: the machines this terminal has paired with, shared with the TUI's
 * Hosts tab and used by `--host` on other commands.
 *
 * @module HostCli
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import { loadHosts, tuiConfigDir } from "./serverClient.ts";

export class HostCliError extends Schema.TaggedError<HostCliError>()("HostCliError", {
  message: Schema.String,
}) {}

const listCommand = Command.make("list").pipe(
  Command.withDescription("Paired machines and their addresses."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const configDir = yield* tuiConfigDir;
      const hosts = yield* Effect.tryPromise({
        try: async () => (await loadHosts()).listHosts(configDir),
        catch: (cause) =>
          new HostCliError({ message: `Could not read paired machines: ${String(cause)}` }),
      });
      yield* Console.log(
        hosts.length === 0
          ? "No paired machines. Pair one with cz host add <link from `cz pair --tailscale` on it>."
          : hosts
              .map((host) => `${host.label}  ${host.httpBaseUrl}${host.enabled ? "" : "  (off)"}`)
              .join("\n"),
      );
    }),
  ),
);

const addCommand = Command.make("add", {
  link: Argument.String("link").pipe(
    Argument.withDescription("The pairing link from `cz pair --tailscale` on that machine."),
  ),
}).pipe(
  Command.withDescription("Pair with another machine, for the TUI and --host."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const configDir = yield* tuiConfigDir;
      const paired = yield* Effect.tryPromise({
        try: async () =>
          (await loadHosts()).pairHost({
            configDir,
            pairingUrl: flags.link.trim(),
            appVersion: packageJson.version,
          }),
        catch: (cause) =>
          new HostCliError({
            message: `Pairing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });
      yield* Console.log(`Paired with ${paired.label}.`);
    }),
  ),
);

export const hostCommand = Command.make("host").pipe(
  Command.withDescription("Machines this terminal has paired with."),
  Command.withSubcommands([listCommand, addCommand]),
);
