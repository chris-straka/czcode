/**
 * Waking a sleeping agent host through any connected environment on its LAN.
 *
 * @module state/hostWake
 */
import {
  createHostWakeEnvironmentAtoms,
  wakeHostFromUrl,
  wakeHostThroughAny,
} from "@cz/client-runtime/state/hostWake";
import type { EnvironmentId } from "@cz/contracts";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "./use-atom-command";
import { useRemoteConnections } from "./use-remote-environment-registry";

export const hostWakeEnvironment = createHostWakeEnvironmentAtoms(connectionAtomRuntime);

/**
 * Wakes the environment through the other connected ones. Resolves to "sent",
 * "unknown" when none of them can wake it, or null when it has no address.
 */
export function useWakeEnvironment() {
  const { connectedEnvironments } = useRemoteConnections();
  const wakeCommand = useAtomCommand(hostWakeEnvironment.wake);
  return useCallback(
    async (environmentId: EnvironmentId): Promise<"sent" | "unknown" | null> => {
      const target = connectedEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      const host = wakeHostFromUrl(target?.displayUrl ?? null);
      if (!host) return null;
      const through = connectedEnvironments
        .filter(
          (environment) =>
            environment.environmentId !== environmentId &&
            environment.connectionState === "connected",
        )
        .map((environment) => environment.environmentId);
      const sentBy = await wakeHostThroughAny<EnvironmentId>({
        host,
        through,
        wake: async (throughId, wakeHost) => {
          const result = await wakeCommand({ environmentId: throughId, input: { host: wakeHost } });
          return result._tag === "Success" ? result.value : null;
        },
      });
      return sentBy === null ? "unknown" : "sent";
    },
    [connectedEnvironments, wakeCommand],
  );
}
