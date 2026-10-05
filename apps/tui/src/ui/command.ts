import { RegistryContext } from "@effect/atom-react";
import { type AtomCommand, runAtomCommand } from "@cz/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { createContext, useCallback, useContext } from "react";

/** Where the TUI shows command failures: one status line, never the console. */
export const StatusContext = createContext<(message: string) => void>(() => {});

/**
 * Runs a client-runtime command and resolves to its value, or null after
 * putting the failure on the status line. Console reporting would tear Ink's
 * frame, so it's off.
 */
export function useCommand<W, A, E>(command: AtomCommand<W, A, E>) {
  const registry = useContext(RegistryContext);
  const setStatus = useContext(StatusContext);
  return useCallback(
    async (value: W): Promise<A | null> => {
      const result = await runAtomCommand(registry, command, value, {
        label: command.label,
        reportFailure: false,
        reportDefect: false,
      });
      if (AsyncResult.isSuccess(result)) return result.value;
      if (!Cause.hasInterruptsOnly(result.cause)) setStatus(failureMessage(result.cause));
      return null;
    },
    [command, registry, setStatus],
  );
}

export function failureMessage(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
