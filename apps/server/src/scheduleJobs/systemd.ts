/**
 * Pure readers for what systemd says about a timer and its service: the
 * schedule in words, `systemctl show` properties, and runs rebuilt from the
 * journal. The journal is the source of truth for runs: after a reboot the
 * service's own properties are empty, and a manual retry overwrites the
 * result of the scheduled run that failed.
 *
 * @module systemd
 */
import type { ScheduleJobRun } from "@cz/contracts";

const DAYS: Record<string, string> = {
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun",
};

/** "*-*-* 06:00:00" reads "Daily 06:00"; anything unusual stays as written. */
export function calendarInWords(onCalendar: string): string {
  const spec = onCalendar.trim();
  const named: Record<string, string> = {
    daily: "Daily 00:00",
    weekly: "Weekly, Mon 00:00",
    monthly: "Monthly, day 1 00:00",
    hourly: "Hourly",
  };
  if (named[spec]) return named[spec];
  // "*:0/10", which systemd shows as "*-*-* *:00/10:00".
  const every = /^(?:\*-\*-\*\s+)?\*:0?0\/(\d+)(?::00)?$/.exec(spec);
  if (every) return `Every ${Number(every[1])} min`;
  const match =
    /^(?:([A-Za-z,.]+)\s+)?(\*|\d{4})-(\*|\d{1,2})-(\*|\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(
      spec,
    );
  if (!match) return spec;
  const [, days, year, month, day, hour, minute] = match;
  const time = `${hour!.padStart(2, "0")}:${minute}`;
  if (year !== "*" || month !== "*") return spec;
  if (day !== "*") return days ? spec : `Monthly, day ${Number(day)} ${time}`;
  if (!days) return `Daily ${time}`;
  const list = days.split(",").map((part) => part.trim());
  if (list.every((part) => DAYS[part])) return `Weekly, ${list.join(", ")} ${time}`;
  return `${days} ${time}`;
}

/** `systemctl show -p A -p B` output as a map. */
export function parseSystemctlShow(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const equals = line.indexOf("=");
    if (equals > 0) values.set(line.slice(0, equals), line.slice(equals + 1).trim());
  }
  return values;
}

/** `systemctl show` output for several units: one map per unit, in the order asked. */
export function parseSystemctlShowUnits(text: string): ReadonlyArray<ReadonlyMap<string, string>> {
  return text
    .split(/\n\s*\n/)
    .filter((block) => block.trim().length > 0)
    .map(parseSystemctlShow);
}

/**
 * True for a unit the OS or a package installed (apt, logrotate, snap...),
 * as opposed to one written on this machine under /etc, ~/.config or /run.
 */
export function isVendorUnit(unit: string, fragmentPath: string | undefined): boolean {
  if (unit.startsWith("snap.")) return true;
  const file = fragmentPath?.trim() ?? "";
  return file === "" || /^\/(usr|lib)\//.test(file);
}

/** "@1791460800" (from `--timestamp=unix`) as epoch ms; null when unset. */
export function unixTimestampMs(value: string | undefined): number | null {
  const match = /^@(\d+)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) * 1000 : null;
}

/** The OnCalendar spec inside TimersCalendar ("{ OnCalendar=… ; next_elapse=… }"). */
export function onCalendarOf(timersCalendar: string | undefined): string | null {
  const match = /OnCalendar=([^;}]+)/.exec(timersCalendar ?? "");
  return match ? match[1]!.trim() : null;
}

export interface JournalEntry {
  /** Microseconds since the epoch (`__REALTIME_TIMESTAMP`). */
  readonly us: number;
  readonly message: string;
}

export interface UnitRun extends ScheduleJobRun {
  readonly at: number;
}

const BOILERPLATE =
  /^(Starting |Started |Finished |Failed with result|Failed to start |Deactivated successfully|Consumed |.*Main process exited)/;
const TROUBLE = /unable|error|fail|no such|denied|not found|panic|traceback|refused|killed/i;

/** The unit name prefix systemd puts on its own lines ("feeds-watch.service: "). */
function stripUnitPrefix(message: string): string {
  return message.replace(/^[\w@.-]+\.service: /, "");
}

/**
 * Runs of a service, oldest first, rebuilt from its journal lines: a run
 * starts at "Starting …", fails at "Failed …", succeeds at "Finished …" or
 * "Deactivated successfully". A failed run's reason is its first line that
 * sounds like trouble, else the exit status line.
 */
export function runsFromJournal(entries: ReadonlyArray<JournalEntry>): ReadonlyArray<UnitRun> {
  const runs: Array<{
    at: number;
    status: UnitRun["status"];
    reason: string | null;
    lines: string[];
    exit: string | null;
  }> = [];
  for (const entry of entries) {
    const message = stripUnitPrefix(entry.message);
    const current = runs.at(-1);
    if (message.startsWith("Starting ")) {
      runs.push({
        at: Math.round(entry.us / 1000),
        status: "running",
        reason: null,
        lines: [],
        exit: null,
      });
      continue;
    }
    if (!current || current.status !== "running") continue;
    if (/Main process exited/.test(message)) current.exit = message;
    if (/^Failed with result|^Failed to start /.test(message)) {
      current.status = "failed";
      const trouble = current.lines.find((line) => TROUBLE.test(line));
      current.reason = trouble ?? current.exit ?? message;
    } else if (/^Finished |^Deactivated successfully/.test(message)) {
      current.status = "ok";
    } else if (!BOILERPLATE.test(message)) {
      current.lines.push(message);
    }
  }
  return runs.map(({ at, status, reason }) => ({ at, status, reason }));
}

/**
 * The run the timer started: the one beginning within two minutes after the
 * timer's last trigger. A later manual run doesn't hide a failed scheduled one.
 */
export function scheduledRun(
  runs: ReadonlyArray<UnitRun>,
  lastTriggerMs: number | null,
): UnitRun | null {
  if (lastTriggerMs === null) return null;
  return (
    runs.findLast((run) => run.at >= lastTriggerMs - 5_000 && run.at <= lastTriggerMs + 120_000) ??
    null
  );
}
