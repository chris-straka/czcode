import type { ThreadControlSummary } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchThread, shortThreadId, threadsTitled } from "./thread.ts";

const summary = (threadId: string) => ({ threadId }) as ThreadControlSummary;

describe("cz thread ids", () => {
  const threads = [
    summary("thread:project:p1:af644f68-c90a"),
    summary("thread:project:p1:5869cb74-4a53"),
    summary("thread:project:p1:58aa0000-0000"),
  ];

  it("shortens to the start of the last part", () => {
    expect(shortThreadId("thread:project:p1:af644f68-c90a")).toBe("af644f68");
  });

  it("matches a full id or a unique short prefix, and explains anything else", () => {
    expect(matchThread(threads, "thread:project:p1:5869cb74-4a53")).toBe(threads[1]);
    expect(matchThread(threads, "af64")).toBe(threads[0]);
    expect(matchThread(threads, "58")).toBe("58 matches 2 threads; give more of the id.");
    expect(matchThread(threads, "zz")).toBe("No thread zz. See cz thread list.");
  });
});

describe("cz thread archive --titled", () => {
  const thread = (threadId: string, title: string, archived = false) =>
    ({ threadId, title, archived }) as ThreadControlSummary;

  it("picks live threads whose title starts with the prefix", () => {
    const threads = [
      thread("a", "Lead: horde-tactics"),
      thread("b", "Lead: undertow", true),
      thread("c", "Level editor part 11"),
      thread("d", "Host lead: basement"),
    ];
    expect(threadsTitled(threads, "Lead: ").map((t) => t.threadId)).toEqual(["a"]);
    expect(threadsTitled(threads, "Host lead: ").map((t) => t.threadId)).toEqual(["d"]);
  });
});
