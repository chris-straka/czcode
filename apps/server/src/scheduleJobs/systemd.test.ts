import { describe, expect, it } from "vite-plus/test";

import {
  calendarInWords,
  onCalendarOf,
  parseSystemctlShow,
  runsFromJournal,
  scheduledRun,
  unixTimestampMs,
} from "./systemd.ts";

// f's feeds-watch on 2026-10-07: the 06:00 run failed (binary missing), a
// manual run at 15:34 worked. Messages as journalctl -o json gives them.
const journal = [
  [1791374400609193, "Starting feeds-watch.service - Daily public-data pull..."],
  [
    1791374400892809,
    "feeds-watch.service: Unable to locate executable '/home/f/.cargo/bin/feeds': No such file or directory",
  ],
  [
    1791374400893585,
    "feeds-watch.service: Failed at step EXEC spawning /home/f/.cargo/bin/feeds: No such file or directory",
  ],
  [1791374400897564, "feeds-watch.service: Main process exited, code=exited, status=203/EXEC"],
  [1791374400897717, "feeds-watch.service: Failed with result 'exit-code'."],
  [1791374400898223, "Failed to start feeds-watch.service - Daily public-data pull..."],
  [1791408880256729, "Starting feeds-watch.service - Daily public-data pull..."],
  [1791408882468912, "abs/CPI:1.10001.10.50.M: updated (29 rows, 377797e23779)"],
  [1791408902299587, "skip fred: needs FRED_API_KEY"],
  [1791409464000000, "feeds-watch.service: Deactivated successfully."],
  [1791409464100000, "Finished feeds-watch.service - Daily public-data pull..."],
].map(([us, message]) => ({ us: us as number, message: message as string }));

describe("systemd jobs", () => {
  it("says schedules in words", () => {
    expect(calendarInWords("*-*-* 06:00:00")).toBe("Daily 06:00");
    expect(calendarInWords("Mon *-*-* 08:00:00")).toBe("Weekly, Mon 08:00");
    expect(calendarInWords("Mon,Thu *-*-* 8:00")).toBe("Weekly, Mon, Thu 08:00");
    expect(calendarInWords("*-*-01 06:00:00")).toBe("Monthly, day 1 06:00");
    expect(calendarInWords("daily")).toBe("Daily 00:00");
    expect(calendarInWords("*:0/15")).toBe("*:0/15");
  });

  it("reads systemctl show output with unix timestamps", () => {
    const show = parseSystemctlShow(
      "Unit=feeds-watch.service\nTimersCalendar={ OnCalendar=*-*-* 06:00:00 ; next_elapse=@1791460800 }\nNextElapseUSecRealtime=@1791460800\nLastTriggerUSec=@1791374400\n",
    );
    expect(unixTimestampMs(show.get("NextElapseUSecRealtime"))).toBe(1791460800000);
    expect(onCalendarOf(show.get("TimersCalendar"))).toBe("*-*-* 06:00:00");
    expect(unixTimestampMs("")).toBeNull();
  });

  it("rebuilds runs from the journal, with why a run failed", () => {
    const runs = runsFromJournal(journal);
    expect(runs.map((run) => run.status)).toEqual(["failed", "ok"]);
    expect(runs[0]!.reason).toBe(
      "Unable to locate executable '/home/f/.cargo/bin/feeds': No such file or directory",
    );
  });

  it("keeps the failed scheduled run visible after a manual retry worked", () => {
    const runs = runsFromJournal(journal);
    expect(scheduledRun(runs, 1791374400000)).toMatchObject({ status: "failed" });
    expect(runs.at(-1)).toMatchObject({ status: "ok" });
  });
});
