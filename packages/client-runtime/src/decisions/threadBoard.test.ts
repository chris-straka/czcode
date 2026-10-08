import { describe, expect, it } from "vite-plus/test";

import {
  type BoardThreadStatus,
  groupRetries,
  latestRuns,
  summarizeProjects,
} from "./threadBoard.ts";

interface T {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly project: string;
  readonly status: BoardThreadStatus;
}

const at = (hour: number) => `2026-10-08T${String(hour).padStart(2, "0")}:00:00Z`;
const t = (
  id: string,
  title: string,
  hour: number,
  status: BoardThreadStatus,
  project = "p",
): T => ({
  id,
  title,
  updatedAt: at(hour),
  project,
  status,
});
const statusOf = (thread: T) => thread.status;

describe("groupRetries", () => {
  it("folds retries of one title into a single run, newest try first", () => {
    const runs = groupRetries(
      [
        t("a", "Resume: data & MLOps", 1, "failed"),
        t("b", "Resume: systems", 2, "failed"),
        t("c", "Resume:  data & mlops ", 3, "failed"),
        t("d", "Resume: data & MLOps", 2, "failed"),
      ],
      statusOf,
    );
    expect(runs.map((run) => run.tries.map((thread) => thread.id))).toEqual([
      ["c", "d", "a"],
      ["b"],
    ]);
    expect(runs[0]?.lead.id).toBe("c");
  });

  it("leads with the try that is running, over a newer failed one", () => {
    const [run] = groupRetries(
      [t("old", "Build", 1, "running"), t("new", "Build", 5, "failed")],
      statusOf,
    );
    expect(run?.lead.id).toBe("old");
    expect(run?.status).toBe("running");
  });

  it("orders runs needs-you, running, failed, then finished by recency", () => {
    const runs = groupRetries(
      [
        t("done", "A", 9, "done"),
        t("fail", "B", 8, "failed"),
        t("run", "C", 1, "running"),
        t("wait", "D", 2, "needs-you"),
      ],
      statusOf,
    );
    expect(runs.map((run) => run.lead.id)).toEqual(["wait", "run", "fail", "done"]);
  });
});

describe("summarizeProjects", () => {
  const threads = [
    t("q1", "Old", 23, "done", "quiet"),
    t("b1", "Busy", 2, "running", "busy"),
    t("w1", "Ask", 1, "needs-you", "waiting"),
    t("r1", "Resume", 3, "failed", "resume"),
    t("r2", "Resume", 4, "failed", "resume"),
    t("r3", "Other", 5, "done", "resume"),
  ];
  const summaries = summarizeProjects(threads, (thread) => thread.project, statusOf);

  it("orders projects needing the owner, then running, then most recent", () => {
    expect(summaries.map((summary) => summary.project)).toEqual([
      "waiting",
      "busy",
      "quiet",
      "resume",
    ]);
  });

  it("counts failed tasks once per retry group and lists finished threads to clear", () => {
    const resume = summaries.find((summary) => summary.project === "resume")!;
    expect(resume.failed).toBe(1);
    expect(resume.threadCount).toBe(3);
    expect(resume.finished.map((thread) => thread.id).sort()).toEqual(["r1", "r2", "r3"]);
    const busy = summaries.find((summary) => summary.project === "busy")!;
    expect(busy.finished).toEqual([]);
    expect(busy.running).toBe(1);
  });

  it("previews the newest tasks first", () => {
    const resume = summaries.find((summary) => summary.project === "resume")!;
    expect(latestRuns(resume, 2).map((run) => run.lead.id)).toEqual(["r3", "r2"]);
  });
});
