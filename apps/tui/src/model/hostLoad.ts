/**
 * How far each host has got with a screen's data, so a screen shows what has
 * arrived and names the hosts it's still waiting on instead of waiting for
 * all of them. A host that is retrying its connection, or has been loading
 * past the slow threshold, stops holding the screen up.
 *
 * @module hostLoad
 */
import type { SupervisorConnectionState } from "@cz/client-runtime/connection";

export type HostLoad = "ready" | "loading" | "slow" | "retrying" | "offline";

/** How long a host may load before the screen stops waiting on it. */
export const SLOW_HOST_MS = 8000;

export function hostLoad(input: {
  readonly phase: SupervisorConnectionState["phase"] | null;
  /** The host's data arrived (a refresh failing later keeps it ready). */
  readonly hasValue: boolean;
  readonly failed: boolean;
  /** How long the screen has been waiting. */
  readonly waitedMs: number;
}): HostLoad {
  if (input.hasValue) return "ready";
  if (input.failed || input.phase === "offline" || input.phase === "blocked") return "offline";
  if (input.phase === "backoff") return "retrying";
  return input.waitedMs >= SLOW_HOST_MS ? "slow" : "loading";
}

export interface HostLoadEntry {
  readonly label: string;
  readonly load: HostLoad;
}

/** True while any host may still answer soon: the screen's empty state should say "loading". */
export function anyLoading(hosts: ReadonlyArray<HostLoadEntry>): boolean {
  return hosts.some((host) => host.load === "loading");
}

const WORD: Record<Exclude<HostLoad, "ready">, string> = {
  loading: "loading",
  slow: "not answering",
  retrying: "unreachable, retrying",
  offline: "offline",
};

/** "f-ms-7917 unreachable, retrying · z loading", or null when every host answered. */
export function hostLoadSummary(hosts: ReadonlyArray<HostLoadEntry>): string | null {
  const waiting = hosts.flatMap((host) =>
    host.load === "ready" ? [] : [`${host.label} ${WORD[host.load]}`],
  );
  return waiting.length > 0 ? waiting.join(" · ") : null;
}
