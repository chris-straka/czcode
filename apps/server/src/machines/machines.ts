/**
 * Pure pieces of the machine list, kept apart from MachineDirectory for tests.
 *
 * @module machineRules
 */
import type { EnvironmentId, ExecutionEnvironmentDescriptor, Machine } from "@cz/contracts";

/** A machine this computer saved, with the credential this computer holds for it. */
export interface SavedMachine {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}

/** A cz server that answered on an online tailnet peer's HTTPS name. */
export interface FoundMachine {
  readonly httpBaseUrl: string;
  readonly descriptor: ExecutionEnvironmentDescriptor;
}

/**
 * This server first, then machines it is signed in to, then ones it only
 * found, each by label. A machine both saved and found is one entry.
 */
export function mergeMachines(input: {
  readonly self: ExecutionEnvironmentDescriptor;
  readonly selfUrl: string | null;
  readonly saved: ReadonlyArray<SavedMachine>;
  readonly found: ReadonlyArray<FoundMachine>;
}): ReadonlyArray<Machine> {
  const byId = new Map<string, Machine>();
  const foundById = new Map(input.found.map((entry) => [entry.descriptor.environmentId, entry]));
  for (const entry of input.found) {
    byId.set(entry.descriptor.environmentId, {
      environmentId: entry.descriptor.environmentId,
      label: entry.descriptor.label,
      httpBaseUrl: entry.httpBaseUrl,
      platform: entry.descriptor.platform,
      online: true,
      signedIn: false,
      self: false,
    });
  }
  for (const entry of input.saved) {
    const found = foundById.get(entry.environmentId as EnvironmentId);
    byId.set(entry.environmentId, {
      environmentId: entry.environmentId as EnvironmentId,
      label: entry.label,
      httpBaseUrl: entry.httpBaseUrl,
      ...(found ? { platform: found.descriptor.platform } : {}),
      online: found !== undefined,
      signedIn: true,
      self: false,
    });
  }
  const own = foundById.get(input.self.environmentId);
  byId.set(input.self.environmentId, {
    environmentId: input.self.environmentId,
    label: input.self.label,
    httpBaseUrl: own?.httpBaseUrl ?? input.selfUrl ?? "",
    platform: input.self.platform,
    online: true,
    signedIn: true,
    self: true,
  });
  const rank = (machine: Machine) => (machine.self ? 0 : machine.signedIn ? 1 : 2);
  return [...byId.values()].toSorted(
    (left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label),
  );
}

/** Finds a machine by label, environment id, or (the first label of) its host name. */
export function findMachine<
  A extends {
    readonly label: string;
    readonly environmentId: string;
    readonly httpBaseUrl: string;
  },
>(machines: ReadonlyArray<A>, wanted: string): A | undefined {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return undefined;
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  };
  return (
    machines.find((machine) => machine.environmentId === wanted.trim()) ??
    machines.find((machine) => machine.label.toLowerCase() === needle) ??
    machines.find((machine) => {
      const host = hostOf(machine.httpBaseUrl);
      return host === needle || host.split(".")[0] === needle;
    })
  );
}
