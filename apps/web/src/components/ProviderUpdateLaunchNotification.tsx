import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDismissedProviderUpdateNotificationKeys } from "../providerUpdateDismissal";
import {
  useProviderUpdateMachines,
  useRunProviderUpdates,
} from "./ProviderUpdateLaunchNotification.machines";
import {
  collectProviderUpdateCandidates,
  getProviderUpdateNoticeTitle,
  getProviderUpdateRunRows,
  getProviderUpdateRunSummary,
  providerUpdateNoticeKey,
  type ProviderUpdateMachine,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";
import { ProviderUpdateRunRows } from "./ProviderUpdateRunRows";
import { hiddenToastActionProps, stackedThreadToast, toastManager } from "./ui/toast";

const seenProviderUpdateNotificationKeys = new Set<string>();
type ProviderUpdateToastId = ReturnType<typeof toastManager.add>;

// While a machine is still connecting, defer the notice so it covers every
// machine. Cap the wait so a stuck machine can't hide the others' updates.
const SETTLING_GRACE_MS = 30_000;
const SUCCESS_VISIBLE_MS = 4_000;
const FAILURE_VISIBLE_MS = 20_000;

const leadingIcon = <DownloadIcon aria-hidden="true" className="size-4 text-success" />;

function behindDescription(machines: ReadonlyArray<ProviderUpdateMachine>): string {
  const labels = machines.map((machine) => machine.label);
  const list =
    labels.length <= 2
      ? labels.join(" and ")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Behind on ${list}.`;
}

/**
 * The launch notice for provider updates. Update sends every outdated provider
 * on every connected machine its update (the same as Providers > Update all),
 * shows each one's progress in place, then says what changed and goes away.
 */
export function ProviderUpdateLaunchNotification() {
  const navigate = useNavigate();
  const { machines, isAnyConnecting } = useProviderUpdateMachines();
  const runProviderUpdates = useRunProviderUpdates();
  const { dismissedNotificationKeys, dismissNotificationKey } =
    useDismissedProviderUpdateNotificationKeys();

  // Update reads the machines at click time, so one that connected after the
  // notice opened is still included.
  const machinesRef = useRef(machines);
  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  const activeToastRef = useRef<{
    readonly toastId: ProviderUpdateToastId;
    readonly key: string;
    running: boolean;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (activeToastRef.current !== null) {
        toastManager.close(activeToastRef.current.toastId);
        activeToastRef.current = null;
      }
    };
  }, []);

  const notificationKey = useMemo(() => providerUpdateNoticeKey(machines), [machines]);
  const candidates = useMemo(
    () => collectProviderUpdateCandidates(machines.flatMap((machine) => machine.candidates)),
    [machines],
  );

  const [settleGraceElapsed, setSettleGraceElapsed] = useState(false);
  useEffect(() => {
    if (!isAnyConnecting) {
      setSettleGraceElapsed(false);
      return;
    }
    const timer = setTimeout(() => setSettleGraceElapsed(true), SETTLING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isAnyConnecting]);
  const isGated = isAnyConnecting && !settleGraceElapsed;

  // Keep the open prompt's machine list current as machines connect.
  useEffect(() => {
    const active = activeToastRef.current;
    if (active && !active.running && machines.length > 0) {
      toastManager.update(active.toastId, { description: behindDescription(machines) });
    }
  }, [machines]);

  const openProviderSettings = useCallback(() => {
    const active = activeToastRef.current;
    if (active !== null) {
      toastManager.close(active.toastId);
      activeToastRef.current = null;
    }
    void navigate({ to: "/settings/providers" });
  }, [navigate]);

  useEffect(() => {
    // Close a prompt the owner hasn't acted on when the updates on offer
    // change: a fresh one replaces it, or nothing is left to update.
    const active = activeToastRef.current;
    if (
      active &&
      !active.running &&
      active.key !== notificationKey &&
      (notificationKey === null || !isGated)
    ) {
      toastManager.close(active.toastId);
      activeToastRef.current = null;
    }

    if (
      !notificationKey ||
      isGated ||
      dismissedNotificationKeys.has(notificationKey) ||
      seenProviderUpdateNotificationKeys.has(notificationKey) ||
      activeToastRef.current !== null
    ) {
      return;
    }
    seenProviderUpdateNotificationKeys.add(notificationKey);
    const key = notificationKey;

    let toastId!: ProviderUpdateToastId;
    const showRuns = (runs: ReadonlyArray<ProviderUpdateRun>) => {
      const summary = getProviderUpdateRunSummary(runs);
      toastManager.update(toastId, {
        type: summary?.type ?? "loading",
        title: summary?.title ?? "Updating providers",
        description: <ProviderUpdateRunRows rows={getProviderUpdateRunRows(runs)} />,
        actionProps: hiddenToastActionProps,
        data: {
          actionLayout: "stacked-end",
          hideCopyButton: true,
          ...(summary
            ? {
                dismissAfterVisibleMs:
                  summary.type === "success" ? SUCCESS_VISIBLE_MS : FAILURE_VISIBLE_MS,
              }
            : {}),
        },
      });
    };
    const runUpdates = () => {
      const active = activeToastRef.current;
      if (active === null || active.toastId !== toastId || active.running) {
        return;
      }
      active.running = true;
      void runProviderUpdates(machinesRef.current, showRuns).finally(() => {
        if (activeToastRef.current?.toastId === toastId) {
          activeToastRef.current = null;
        }
      });
    };

    toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: getProviderUpdateNoticeTitle(candidates),
        description: behindDescription(machinesRef.current),
        timeout: 0,
        actionProps: { children: "Update", onClick: runUpdates },
        actionVariant: "outline",
        data: {
          hideCopyButton: true,
          leadingIcon,
          secondaryActionProps: { children: "Settings", onClick: openProviderSettings },
          secondaryActionVariant: "outline",
          onClose: () => {
            // Closing the prompt declines this release; closing a run's
            // progress or result does not.
            const current = activeToastRef.current;
            if (current?.toastId !== toastId) {
              return;
            }
            if (!current.running) {
              dismissNotificationKey(key);
            }
            activeToastRef.current = null;
          },
        },
      }),
    );
    activeToastRef.current = { toastId, key, running: false };
  }, [
    notificationKey,
    isGated,
    candidates,
    dismissedNotificationKeys,
    dismissNotificationKey,
    openProviderSettings,
    runProviderUpdates,
  ]);

  return null;
}
