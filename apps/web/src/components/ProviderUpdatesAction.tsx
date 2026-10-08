import { PROVIDER_DISPLAY_NAMES } from "@cz/contracts";
import { useRef, useState } from "react";

import {
  useProviderUpdateMachines,
  useRunProviderUpdates,
} from "./ProviderUpdateLaunchNotification.machines";
import {
  getProviderUpdateRunRows,
  getProviderUpdateRunSummary,
} from "./ProviderUpdateLaunchNotification.logic";
import { ProviderUpdateRunRows } from "./ProviderUpdateRunRows";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Updates every outdated provider on every connected machine at once, then
 * reports one line per update in a toast. Renders nothing when no machine has
 * a one-click update.
 */
export function ProviderUpdatesAction() {
  const { machines } = useProviderUpdateMachines();
  const runProviderUpdates = useRunProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  // Candidates leave the list as soon as their servers report them queued, so
  // keep the button while the run is in flight.
  if (machines.length === 0 && !isPending) {
    return null;
  }

  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    try {
      const runs = await runProviderUpdates(machines, () => {});
      const summary = getProviderUpdateRunSummary(runs);
      if (summary) {
        toastManager.add(
          stackedThreadToast({
            ...summary,
            description: <ProviderUpdateRunRows rows={getProviderUpdateRunRows(runs)} />,
          }),
        );
      }
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={() => void handleUpdate()}
          >
            {isPending ? "Updating…" : "Update all"}
          </Button>
        }
      />
      <TooltipPopup side="top">
        {machines.map((machine) => (
          <div key={machine.environmentId}>
            {machine.label}:{" "}
            {machine.candidates
              .map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver)
              .join(", ")}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
