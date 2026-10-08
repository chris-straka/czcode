/**
 * MorningBriefService - the owner's brief for this machine: threads that ended
 * since they last looked, in a few lines they read on a phone. Done work is
 * grouped by the project folder it touched, failures by cause, and runs that
 * were interrupted or cancelled are "stopped", never "failed". The text
 * generation model writes one line per group; until it answers, or when it
 * can't, each line is a plain count.
 *
 * The brief covers everything since the owner last read (dismissed) one, which
 * is stored here so dismissing on one device hides it on the others.
 *
 * @module MorningBriefService
 */
import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadShell,
  type ThreadBrief,
  type ThreadBriefGroup,
  ThreadId,
} from "@cz/contracts";
import { HostProcessEnvironment } from "@cz/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { MorningBriefPromptGroup } from "../textGeneration/TextGenerationPrompts.ts";
import * as ThreadDigestService from "./ThreadDigestService.ts";

export class MorningBriefService extends Context.Service<
  MorningBriefService,
  {
    readonly brief: Effect.Effect<ThreadBrief>;
    /** The owner read (dismissed) the brief: the next one starts from now. */
    readonly markRead: Effect.Effect<void>;
    /** Asks each stopped or failed thread to pick up where it left off; returns how many were sent. */
    readonly retry: (threadIds: ReadonlyArray<string>) => Effect.Effect<number>;
  }
>()("cz/threadControl/MorningBriefService") {}

/** Before the first read, the brief covers this much. */
const FIRST_WINDOW_MS = 14 * 60 * 60_000;
/** However long the owner was away, the brief covers at most this much. */
const MAX_WINDOW_MS = 3 * 24 * 60 * 60_000;
/** How long a request waits for the model before answering with counts. */
const WRITE_WAIT = "20 seconds";
const MAX_THREADS = 100;
const RETRY_MESSAGE =
  "Your last run ended before it finished. Pick up where you left off and finish the task.";

/** Where the brief starts: when the owner last read one. */
export function briefSince(readAt: number | null, now: number): number {
  return Math.max(readAt ?? now - FIRST_WINDOW_MS, now - MAX_WINDOW_MS);
}

export type BriefOutcome = ThreadBriefGroup["kind"];

/** Interrupted and cancelled runs were stopped, not failed. */
export function briefOutcome(status: OrchestrationV2ThreadShell["status"]): BriefOutcome | null {
  switch (status) {
    case "idle":
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "interrupted":
    case "cancelled":
      return "stopped";
    default:
      return null;
  }
}

/** Failures a second try may get past. */
const TRANSIENT_CAUSES = new Set(["usage_limit", "provider_error", "transport_error"]);

const CAUSE_LABELS: Record<string, string> = {
  usage_limit: "Usage limit",
  provider_error: "Provider error",
  transport_error: "Connection lost",
  permission_error: "Permission denied",
  validation_error: "Rejected request",
};

export interface BriefThread {
  readonly threadId: string;
  readonly title: string;
  readonly outcome: BriefOutcome;
  /** The project folder it worked in ("hll"), else its project's title. */
  readonly project: string;
  readonly errorClass: string | null;
  readonly error: string | null;
  /** The start of its last agent message. */
  readonly excerpt: string | null;
}

/** "games/_tools" reads "tools"; a thread that worked in the project root gets its title. */
export function briefProject(workingSubpath: string | null, projectTitle: string | undefined) {
  const folder = workingSubpath?.split("/").at(-1)?.replace(/^_+/, "");
  return folder || projectTitle || "";
}

export interface BriefGroupDraft {
  readonly key: string;
  readonly kind: BriefOutcome;
  readonly label: string;
  readonly action: ThreadBriefGroup["action"];
  readonly threads: ReadonlyArray<BriefThread>;
}

/** Done by project (most work first), then failed by cause, then stopped. */
export function briefGroups(threads: ReadonlyArray<BriefThread>): ReadonlyArray<BriefGroupDraft> {
  const groups = new Map<
    string,
    {
      kind: BriefOutcome;
      label: string;
      action: ThreadBriefGroup["action"];
      threads: BriefThread[];
    }
  >();
  for (const thread of threads) {
    const label =
      thread.outcome === "done"
        ? thread.project
        : thread.outcome === "failed"
          ? (CAUSE_LABELS[thread.errorClass ?? ""] ?? "Failed")
          : "Stopped";
    const key = `${thread.outcome}:${label}`;
    const action =
      thread.outcome === "stopped"
        ? "dismiss"
        : thread.outcome === "failed" && TRANSIENT_CAUSES.has(thread.errorClass ?? "")
          ? "retry"
          : "open";
    const group = groups.get(key) ?? { kind: thread.outcome, label, action, threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  const rank: Record<BriefOutcome, number> = { done: 0, failed: 1, stopped: 2 };
  return [...groups]
    .map(([key, group]) => ({ key, ...group }))
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        b.threads.length - a.threads.length ||
        a.label.localeCompare(b.label),
    );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The line a group gets when the model hasn't written one. */
export function plainLine(group: BriefGroupDraft): string {
  const count = group.threads.length;
  switch (group.kind) {
    case "done":
      return `${plural(count, "thread")} finished`;
    case "failed": {
      const error = group.threads.find((thread) => thread.error)?.error?.replace(/\s+/g, " ");
      const reason = error ? `: ${error.length > 100 ? `${error.slice(0, 99)}…` : error}` : "";
      return `${plural(count, "thread")} failed${reason}`;
    }
    case "stopped":
      return `${plural(count, "thread")} stopped before finishing`;
  }
}

function promptGroup(group: BriefGroupDraft): MorningBriefPromptGroup {
  return {
    key: group.key,
    kind: group.kind,
    label: group.label,
    threads: group.threads.map((thread) => ({
      title: thread.title,
      result:
        (group.kind === "failed" ? thread.error : null) ?? thread.excerpt ?? "(no final message)",
    })),
  };
}

const toMs = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

const make = Effect.gen(function* () {
  const { sql } = yield* ForkDatabase.ForkDatabase;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const digests = yield* ThreadDigestService.ThreadDigestService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* HostProcessEnvironment;
  const scope = yield* Effect.scope;
  // The latest written brief, by the threads it covers. A thread ending changes the key.
  let written: {
    readonly key: string;
    readonly lines: Deferred.Deferred<ReadonlyMap<string, string> | null>;
  } | null = null;

  const readAt = sql<{ value: string }>`
    SELECT value FROM brief_state WHERE name = 'read_at'
  `.pipe(Effect.map((rows) => (rows[0] === undefined ? null : Number(rows[0].value))));

  const markRead: MorningBriefService["Service"]["markRead"] = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`
      INSERT INTO brief_state ${sql.insert({ name: "read_at", value: String(now), updated_at: now })}
      ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `;
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Marking the brief read failed", { cause })),
    Effect.withSpan("MorningBriefService.markRead"),
  );

  const endedThreads = Effect.fn("MorningBriefService.endedThreads")(function* (since: number) {
    const snapshot = yield* projections.getShellSnapshot();
    const ended = snapshot.threads
      .flatMap((thread) => {
        const outcome = briefOutcome(thread.status);
        const endedAt = toMs(thread.latestRunCompletedAt);
        return thread.archivedAt === null &&
          thread.deletedAt === null &&
          thread.lineage.relationshipToParent !== "subagent" &&
          thread.activeRunId === null &&
          outcome !== null &&
          endedAt !== null &&
          endedAt >= since
          ? [{ thread, outcome, endedAt }]
          : [];
      })
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, MAX_THREADS);
    const projectTitles = new Map(
      (yield* projects.snapshot).projects.map((project) => [project.id as string, project.title]),
    );
    const digestById = new Map(
      (yield* digests.digests(ended.map(({ thread }) => thread.id))).map(
        (digest) => [digest.threadId, digest] as const,
      ),
    );
    return ended.map(({ thread, outcome, endedAt }) => {
      const digest = digestById.get(thread.id);
      return {
        threadId: thread.id,
        title: thread.title,
        outcome,
        project: briefProject(digest?.workingSubpath ?? null, projectTitles.get(thread.projectId)),
        errorClass: thread.lastErrorClass ?? null,
        error: thread.lastError ?? null,
        excerpt: digest?.excerpt ?? null,
        endedAt,
      };
    });
  });

  /** Lines from the model for these groups, or null when it can't write them. */
  const writeLines = (groups: ReadonlyArray<BriefGroupDraft>) =>
    Effect.gen(function* () {
      const modelSelection = (yield* settings.getSettings).textGenerationModelSelection;
      const result = yield* textGeneration.generateMorningBrief({
        cwd: environment.HOME ?? environment.USERPROFILE ?? ".",
        groups: groups.map(promptGroup),
        modelSelection,
      });
      return result.lines;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Writing the brief failed", { cause }).pipe(Effect.as(null)),
      ),
    );

  const brief: MorningBriefService["Service"]["brief"] = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const read = yield* readAt;
    const since = briefSince(read, now);
    const threads = yield* endedThreads(since);
    const groups = briefGroups(threads);
    const present = (lines: ReadonlyMap<string, string> | null, state: ThreadBrief["lines"]) =>
      ({
        since,
        readAt: read,
        lines: state,
        groups: groups.map((group) => ({
          kind: group.kind,
          label: group.label,
          action: group.action,
          text: lines?.get(group.key) ?? plainLine(group),
          threadIds: group.threads.map((thread) => thread.threadId),
        })),
      }) satisfies ThreadBrief;
    if (groups.length === 0) return present(null, "written");

    const key = threads
      .map((thread) => `${thread.threadId}:${thread.outcome}:${thread.endedAt}`)
      .join("|");
    if (written?.key !== key) {
      const lines = yield* Deferred.make<ReadonlyMap<string, string> | null>();
      written = { key, lines };
      yield* writeLines(groups).pipe(
        Effect.flatMap((result) => Deferred.succeed(lines, result)),
        Effect.forkIn(scope),
      );
    }
    const lines = yield* Deferred.await(written.lines).pipe(Effect.timeoutOption(WRITE_WAIT));
    if (Option.isNone(lines)) return present(null, "pending");
    // A failed write is tried again on the next request, which comes when a thread ends.
    if (lines.value === null) written = null;
    return present(lines.value, lines.value === null ? "plain" : "written");
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Building the brief failed", { cause }).pipe(
        Effect.flatMap(() => Clock.currentTimeMillis),
        Effect.map((now): ThreadBrief => ({
          since: now,
          readAt: null,
          groups: [],
          lines: "plain",
        })),
      ),
    ),
    Effect.withSpan("MorningBriefService.brief"),
  );

  const retry: MorningBriefService["Service"]["retry"] = Effect.fn("MorningBriefService.retry")(
    function* (threadIds) {
      let sent = 0;
      for (const id of threadIds) {
        const threadId = ThreadId.make(id);
        const thread = yield* projections.getThreadShell(threadId);
        if (thread === null || thread.deletedAt !== null || thread.activeRunId !== null) continue;
        const requestId = yield* crypto.randomUUIDv4;
        const delivered = yield* threadManagement
          .sendToThread({
            projectId: thread.projectId,
            commandId: CommandId.make(`brief-retry:${requestId}`),
            threadId,
            messageId: MessageId.make(`message:brief-retry:${requestId}`),
            text: RETRY_MESSAGE,
            attachments: [],
            mode: "auto",
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.logWarning("Retrying a thread from the brief failed", {
                threadId,
                cause,
              }).pipe(Effect.as(false)),
            ),
          );
        if (delivered) sent += 1;
      }
      return sent;
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Retrying threads from the brief failed", { cause }).pipe(Effect.as(0)),
    ),
  );

  return MorningBriefService.of({ brief, markRead, retry });
});

export const layer = Layer.effect(MorningBriefService, make);
