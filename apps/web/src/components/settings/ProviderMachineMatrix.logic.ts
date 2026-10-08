import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@cz/contracts";

export type ProviderMachineCellState =
  | "signed-in"
  | "signed-out"
  | "not-installed"
  | "disabled"
  | "problem";

export interface ProviderMachineCell {
  readonly state: ProviderMachineCellState;
  readonly version: string | null;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
  readonly updating: boolean;
}

export interface ProviderMachineRow {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly name: string;
  readonly accentColor: string | undefined;
  /** One entry per machine, in column order; null where the machine lacks this provider. */
  readonly cells: readonly (ProviderMachineCell | null)[];
}

export interface ProviderMachineColumn {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Offline machines keep their column so a missing machine is visible, not silently dropped. */
  readonly connected: boolean;
}

function cellFor(provider: ServerProvider): ProviderMachineCell {
  const state: ProviderMachineCellState = !provider.enabled
    ? "disabled"
    : !provider.installed
      ? "not-installed"
      : provider.status === "error"
        ? "problem"
        : provider.auth.status === "authenticated"
          ? "signed-in"
          : provider.auth.status === "unauthenticated"
            ? "signed-out"
            : provider.status === "ready"
              ? "signed-in"
              : "problem";
  const advisory = provider.versionAdvisory;
  const updateStatus = provider.updateState?.status;
  return {
    state,
    version: provider.version,
    latestVersion: advisory?.latestVersion ?? null,
    updateAvailable: provider.enabled && advisory?.status === "behind_latest",
    updating: updateStatus === "queued" || updateStatus === "running",
  };
}

/**
 * Providers down the side, machines across the top. Rows follow first
 * appearance (machines in column order), so the primary machine's order wins.
 */
export function buildProviderMachineMatrix(
  machines: readonly (ProviderMachineColumn & { readonly providers: readonly ServerProvider[] })[],
): readonly ProviderMachineRow[] {
  const rows = new Map<
    ProviderInstanceId,
    Omit<ProviderMachineRow, "cells"> & { cells: (ProviderMachineCell | null)[] }
  >();
  machines.forEach((machine, column) => {
    for (const provider of machine.providers) {
      let row = rows.get(provider.instanceId);
      if (!row) {
        row = {
          instanceId: provider.instanceId,
          driver: provider.driver,
          name: provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
          accentColor: provider.accentColor,
          cells: machines.map(() => null),
        };
        rows.set(provider.instanceId, row);
      }
      row.cells[column] = cellFor(provider);
    }
  });
  return [...rows.values()];
}
