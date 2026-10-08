import { useCallback, useMemo } from "react";

import { useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  collectProviderUpdateMachines,
  providerUpdateRunsFor,
  type ProviderUpdateMachine,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";

/**
 * Every connected machine with an outdated provider, and whether a switched-on
 * machine is still connecting (so the launch notice can wait to include it).
 */
export function useProviderUpdateMachines(): {
  readonly machines: ProviderUpdateMachine[];
  readonly isAnyConnecting: boolean;
} {
  const { environments } = useEnvironments();
  return useMemo(
    () => ({
      machines: collectProviderUpdateMachines(
        environments.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.label,
          connected: environment.connection.phase === "connected",
          providers: environment.serverConfig?.providers ?? [],
        })),
      ),
      isAnyConnecting: environments.some(
        (environment) =>
          environment.entry.enabled &&
          (environment.connection.phase === "connecting" ||
            environment.connection.phase === "reconnecting"),
      ),
    }),
    [environments],
  );
}

/**
 * Sends every outdated provider's update to its machine at once and reports
 * the runs after each one settles. Each server queues updates that share an
 * installer, so sending them together is safe; the server still checks
 * permissions, and a machine this session cannot operate fails its own row.
 */
export function useRunProviderUpdates() {
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  return useCallback(
    async (
      machines: ReadonlyArray<ProviderUpdateMachine>,
      onProgress: (runs: ReadonlyArray<ProviderUpdateRun>) => void,
    ): Promise<ReadonlyArray<ProviderUpdateRun>> => {
      let runs = providerUpdateRunsFor(machines);
      onProgress(runs);
      const targets = machines.flatMap((machine) =>
        machine.candidates.map((candidate) => ({
          environmentId: machine.environmentId,
          candidate,
        })),
      );
      await Promise.all(
        targets.map(async ({ environmentId, candidate }, index) => {
          const result = await updateProvider({
            environmentId,
            input: { provider: candidate.driver, instanceId: candidate.instanceId },
          });
          runs = runs.map((run, runIndex) => (runIndex === index ? { ...run, result } : run));
          onProgress(runs);
        }),
      );
      return runs;
    },
    [updateProvider],
  );
}
