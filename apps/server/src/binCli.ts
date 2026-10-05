import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Argument, Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import {
  adoptLegacyEnv,
  LEGACY_HOME_MIGRATED_MESSAGE,
  legacyEnvWarning,
  migrateLegacyHome,
} from "@cz/shared/legacyNames";
import * as NetService from "@cz/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { acpMcpBridgeCommand, acpMcpCallCommand } from "./cli/acpMcpBridge.ts";
import { authCommand } from "./cli/auth.ts";
import { appCommand } from "./cli/app.ts";
import { connectCommand } from "./cli/connect.ts";
import { pairCommand } from "./cli/pair.ts";
import { hasCloudPublicConfig } from "./cloud/publicConfig.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runDefaultServerCommand, serveCommand, startCommand } from "./cli/server.ts";
import { updateCommand } from "./cli/update.ts";
import { uninstallCommand } from "./cli/uninstall.ts";
import { serviceLauncherCommand } from "./cli/serviceLauncher.ts";
import { claudeHistoryCommand } from "./cli/claudeHistory.ts";
import { sshHelperCommand } from "./cli/sshHelper.ts";
import { serviceCommand } from "./cli/service.ts";
import { servicePreflightCommand } from "./cli/servicePreflight.ts";
import { themeCommand } from "./cli/theme.ts";
import { traceCommand } from "./cli/trace.ts";
import { triageCommand } from "./cli/triage.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const connectPublicConfigMissingMessage =
  "cz Connect commands are unavailable: this build is missing cz Connect public configuration.";

class ConnectPublicConfigMissingError extends CliError.UserError {
  override get message() {
    return connectPublicConfigMissingMessage;
  }
}

const connectUnavailableCommand = Command.make("connect", {
  command: Argument.String("command").pipe(Argument.variadic),
}).pipe(
  Command.withDescription("cz Connect is unavailable in builds without public configuration."),
  Command.unlisted,
  Command.withHandler(() =>
    Effect.fail(
      new CliError.ShowHelp({
        commandPath: ["cz", "connect"],
        errors: [new ConnectPublicConfigMissingError({ cause: connectPublicConfigMissingMessage })],
      }),
    ),
  ),
);

export const makeCli = ({ cloudEnabled = hasCloudPublicConfig } = {}) =>
  Command.make("cz", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription("Run the czcode server."),
    Command.withHandler(runDefaultServerCommand),
    Command.withSubcommands([
      Command.make("help").pipe(
        Command.withDescription("Show command help."),
        Command.withHandler(() =>
          Effect.fail(new CliError.ShowHelp({ commandPath: ["cz"], errors: [] })),
        ),
      ),
      acpMcpBridgeCommand,
      acpMcpCallCommand,
      startCommand,
      serveCommand,
      appCommand,
      pairCommand,
      authCommand,
      projectCommand,
      serviceCommand,
      updateCommand,
      uninstallCommand,
      serviceLauncherCommand,
      claudeHistoryCommand,
      sshHelperCommand,

      servicePreflightCommand,
      themeCommand,
      traceCommand,
      triageCommand,
      cloudEnabled ? connectCommand : connectUnavailableCommand,
    ]),
  );

export const cli = makeCli();

export function runCli() {
  // Before any Config read: pre-rename env vars become their CZ_* names, and
  // the first run with the default data dir copies the old data dir to ~/.cz.
  const adopted = adoptLegacyEnv();
  const defaultHome =
    !process.env.CZ_HOME?.trim() &&
    !process.argv.some((arg) => arg === "--base-dir" || arg.startsWith("--base-dir="));
  Effect.gen(function* () {
    if (adopted.length > 0) yield* Effect.logWarning(legacyEnvWarning(adopted));
    if (defaultHome && (yield* Effect.sync(() => migrateLegacyHome())) === "migrated") {
      yield* Effect.logWarning(LEGACY_HOME_MIGRATED_MESSAGE);
    }
    return yield* Command.run(cli, { version: packageJson.version });
  }).pipe(Effect.scoped, Effect.provide(CliRuntimeLayer), NodeRuntime.runMain);
}
