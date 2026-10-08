import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import type { ProjectionSettlementCandidate } from "../orchestration-v2/ProjectionStore.ts";
import { ARCHIVE_AFTER_MS, shouldAutoArchive } from "./ThreadAutoArchive.ts";

const now = Date.parse("2026-10-08T12:00:00Z");
const at = (ms: number) => DateTime.makeUnsafe(ms);
const old = now - ARCHIVE_AFTER_MS - 60_000;

const thread = (overrides: Partial<ProjectionSettlementCandidate> = {}) =>
  ({
    id: "t1",
    archivedAt: null,
    pinnedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pendingRuntimeRequest: null,
    activityRunStatus: null,
    pendingBackgroundTasks: [],
    updatedAt: at(old),
    createdAt: at(old),
    latestUserMessageAt: at(old),
    latestUserAuthoredMessageAt: at(old),
    latestRunRequestedAt: at(old),
    latestRunStartedAt: at(old),
    latestRunCompletedAt: at(old),
    ...overrides,
  }) as ProjectionSettlementCandidate;

describe("shouldAutoArchive", () => {
  it("archives a finished thread untouched for a week, and nothing still in play", () => {
    const none = new Set<string>();
    expect(shouldAutoArchive(thread(), none, now)).toBe(true);
    expect(shouldAutoArchive(thread({ updatedAt: at(now - 60_000) }), none, now)).toBe(false);
    expect(shouldAutoArchive(thread({ pinnedAt: at(old) }), none, now)).toBe(false);
    expect(shouldAutoArchive(thread({ activityRunStatus: "running" }), none, now)).toBe(false);
    expect(shouldAutoArchive(thread({ snoozedUntil: at(now + 60_000) }), none, now)).toBe(false);
    expect(shouldAutoArchive(thread(), new Set(["t1"]), now)).toBe(false);
  });
});
