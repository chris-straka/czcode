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
import { type EnvironmentPresentation, useEnvironments } from "./environments";
import { useAtomCommand } from "./use-atom-command";

const hostWakeEnvironment = createHostWakeEnvironmentAtoms(connectionAtomRuntime);

/**
 * Wakes `target` through the other connected environments. Resolves to
 * "sent", "unknown" when none of them can wake it, or null when the target has
 * no address to wake by.
 */
export function useWakeEnvironment() {
  const { environments } = useEnvironments();
  const wakeCommand = useAtomCommand(hostWakeEnvironment.wake, {
    label: "wake host",
    reportFailure: false,
  });
  return useCallback(
    async (target: EnvironmentPresentation): Promise<"sent" | "unknown" | null> => {
      const host = wakeHostFromUrl(target.displayUrl);
      if (!host) return null;
      const through = environments
        .filter(
          (environment) =>
            environment.environmentId !== target.environmentId &&
            environment.connection.phase === "connected",
        )
        .map((environment) => environment.environmentId);
      const sentBy = await wakeHostThroughAny<EnvironmentId>({
        host,
        through,
        wake: async (environmentId, wakeHost) => {
          const result = await wakeCommand({ environmentId, input: { host: wakeHost } });
          return result._tag === "Success" ? result.value : null;
        },
      });
      return sentBy === null ? "unknown" : "sent";
    },
    [environments, wakeCommand],
  );
}
