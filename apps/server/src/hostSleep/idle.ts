/**
 * When an agent host may sleep: the pure rules behind HostSleepService.
 *
 * @module hostSleepIdle
 */
import type { OrchestrationV2ThreadShell } from "@cz/contracts";

import { threadHasQueuedTurnStart } from "../orchestration-v2/ThreadSettlementService.ts";

/** A turn running, a message waiting to start one, or background tasks still going. */
export function threadKeepsAwake(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.activeRunId !== null ||
    (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
    threadHasQueuedTurnStart(thread, now)
  );
}

/**
 * Someone using the machine: a logind user session that isn't idle, from
 * `loginctl list-sessions --no-legend` (SESSION UID USER SEAT LEADER CLASS TTY
 * IDLE ...). Tailscale SSH shells count; a desktop left alone reports idle.
 */
export function activeUserSessions(loginctlOutput: string): number {
  return loginctlOutput
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[5] === "user" && fields[7] === "no").length;
}

/** The earliest queued run or enabled scheduled task still to come, in epoch ms. */
export function nextWakeAt(input: {
  readonly queuedRuns: ReadonlyArray<{ readonly status: string; readonly dueAt: number }>;
  readonly scheduledTasks: ReadonlyArray<{
    readonly enabled: boolean;
    readonly nextRunAt: string | null;
  }>;
}): number | null {
  const times = [
    ...input.queuedRuns.filter((run) => run.status === "queued").map((run) => run.dueAt),
    ...input.scheduledTasks
      .filter((task) => task.enabled && task.nextRunAt !== null)
      .map((task) => Date.parse(task.nextRunAt!))
      .filter(Number.isFinite),
  ];
  return times.length === 0 ? null : Math.min(...times);
}

/** Idle long enough, and nothing due before it would be worth sleeping. */
export function shouldSleep(input: {
  readonly idleSince: number;
  readonly now: number;
  readonly idleMs: number;
  readonly wakeAt: number | null;
}): boolean {
  if (input.now - input.idleSince < input.idleMs) return false;
  return input.wakeAt === null || input.wakeAt - input.now > input.idleMs;
}

/** Wake this long before a due run, so the machine is back on the tailnet in time. */
export const WAKE_LEAD_MS = 2 * 60 * 1000;

export interface SleepEvent {
  readonly event: "sleep" | "wake";
  readonly at: number;
}

/** Time asleep since `since`, from the sleep log (an open sleep counts up to `now`). */
export function asleepMs(events: ReadonlyArray<SleepEvent>, since: number, now: number): number {
  let total = 0;
  let sleptAt: number | null = null;
  for (const { event, at } of events) {
    if (event === "sleep") sleptAt = at;
    else if (sleptAt !== null) {
      total += Math.max(0, at - Math.max(sleptAt, since));
      sleptAt = null;
    }
  }
  if (sleptAt !== null) total += Math.max(0, now - Math.max(sleptAt, since));
  return total;
}
