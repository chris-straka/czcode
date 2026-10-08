import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ProviderUpdatesAction } from "../ProviderUpdatesAction";
import { RefreshIcon } from "../ui/refresh-icon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildProviderMachineMatrix,
  type ProviderMachineCell,
  type ProviderMachineCellState,
} from "./ProviderMachineMatrix.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const STATE_LABELS: Record<ProviderMachineCellState, string> = {
  "signed-in": "Signed in",
  "signed-out": "Signed out",
  "not-installed": "Not installed",
  disabled: "Off",
  problem: "Needs attention",
};

const STATE_DOTS: Record<ProviderMachineCellState, string> = {
  "signed-in": "bg-success",
  "signed-out": "bg-warning",
  "not-installed": "bg-muted-foreground/50",
  disabled: "bg-muted-foreground/50",
  problem: "bg-destructive",
};

function MatrixCell({ cell }: { cell: ProviderMachineCell }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="flex items-center gap-1.5 text-foreground">
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", STATE_DOTS[cell.state])}
        />
        {STATE_LABELS[cell.state]}
      </span>
      {cell.version ? (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          v{cell.version.replace(/^v/, "")}
        </span>
      ) : null}
      {cell.updating ? (
        <span className="text-xs text-muted-foreground">Updating…</span>
      ) : cell.updateAvailable ? (
        <span className="text-xs text-warning">
          {cell.latestVersion
            ? `Update to ${cell.latestVersion.replace(/^v/, "")}`
            : "Update available"}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Every provider on every selected machine at a glance: signed in, version,
 * and whether an update is waiting. A cell opens that machine's provider
 * details, where editing stays per machine.
 */
export function ProviderMachineMatrix() {
  const { environments } = useSettingsScope();
  const navigate = useNavigate();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const machines = useMemo(
    () =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected:
          environment.connection.phase === "connected" && environment.serverConfig !== null,
        providers: environment.serverConfig?.providers ?? [],
      })),
    [environments],
  );
  // A provider that is off everywhere is noise here; it stays one click away
  // on each machine's own page.
  const rows = useMemo(
    () =>
      buildProviderMachineMatrix(machines).filter((row) =>
        row.cells.some((cell) => cell !== null && cell.state !== "disabled"),
      ),
    [machines],
  );
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        machines
          .filter((machine) => machine.connected)
          .map((machine) => refreshProviders({ environmentId: machine.environmentId, input: {} })),
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="providers"
        title="Providers on every machine"
        headerAction={
          <span className="flex items-center gap-1">
            <ProviderUpdatesAction />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label="Check every machine again"
                    disabled={refreshing}
                    onClick={() => void refreshAll()}
                  >
                    <RefreshIcon refreshing={refreshing} />
                  </Button>
                }
              />
              <TooltipPopup side="top">Check every machine again</TooltipPopup>
            </Tooltip>
          </span>
        }
      >
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No machine is connected. Connect one to see its providers.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="sticky left-0 bg-card px-3 py-2 font-normal sm:px-4">
                    <span className="sr-only">Provider</span>
                  </th>
                  {machines.map((machine) => (
                    <th key={machine.environmentId} className="px-3 py-2 font-medium">
                      {machine.label}
                      {machine.connected ? null : (
                        <span className="ml-1 font-normal">· Offline</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.instanceId} className="border-t border-border/60 align-top">
                    <th
                      scope="row"
                      className="sticky left-0 bg-card px-3 py-3 text-left font-medium sm:px-4"
                    >
                      <span className="flex items-center gap-2">
                        <ProviderInstanceIcon
                          driverKind={row.driver}
                          displayName={row.name}
                          accentColor={row.accentColor}
                          className="size-4"
                        />
                        {row.name}
                      </span>
                    </th>
                    {row.cells.map((cell, column) => {
                      const machine = machines[column]!;
                      return (
                        <td key={machine.environmentId} className="px-1 py-1">
                          {cell && machine.connected ? (
                            <button
                              type="button"
                              className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`${row.name} on ${machine.label}: ${STATE_LABELS[cell.state]}. Open details`}
                              onClick={() =>
                                void navigate({
                                  to: "/settings/providers",
                                  search: (previous) => ({
                                    ...previous,
                                    machine: machine.environmentId,
                                    instanceId: row.instanceId,
                                  }),
                                })
                              }
                            >
                              <MatrixCell cell={cell} />
                            </button>
                          ) : (
                            <span className="block px-2 py-1.5 text-muted-foreground">
                              {machine.connected ? "Not set up" : "Offline"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
