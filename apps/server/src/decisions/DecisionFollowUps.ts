/**
 * What happens after the owner answers (ccez/DECISIONS.md): an approved pitch
 * becomes a task for the next quota reset, and an answer to an agent that
 * moved on (non-blocking, with a resume plan) starts a resume thread with the
 * decision attached, through the reset queue when the quota is spent.
 *
 * Each decision gets one run at most (the queue keys runs by decision), and
 * the last day's answers are re-checked on boot so a restart loses none.
 * When the asking thread is archived or deleted, its open questions are
 * withdrawn: nobody is left to act on the answer.
 *
 * @module DecisionFollowUps
 */
import type {
  DecisionAnswer,
  DecisionItem,
  ModelSelection,
  Project,
  QueuedRunInput,
  ServerProvider,
} from "@cz/contracts";
import { ThreadId } from "@cz/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@cz/shared/model";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as OrchestratorV2 from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ResetQueueService from "../resetQueue/ResetQueueService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as DecisionService from "./DecisionService.ts";

const CATCH_UP_MS = 24 * 60 * 60 * 1000;

type FollowUp = Pick<QueuedRunInput, "title" | "prompt" | "start" | "source"> & {
  readonly project: string;
  readonly threadId: string | null;
  readonly provider: string | null;
};

/** The run an answer calls for, before resolving its project and model. */
export function followUpFor(item: DecisionItem, answer: DecisionAnswer): FollowUp | null {
  const threadId = item.resume?.thread_id ?? item.thread ?? null;
  const provider = item.resume?.provider ?? null;
  const decided = `The owner answered decision ${item.id} ("${item.question}"): ${describeAnswer(item, answer)}. Call get_decision with id ${item.id} for the full answer and any files.`;
  if (item.kind === "pitch") {
    if (answer.choice !== "yes") return null;
    return {
      title: item.title || item.question,
      prompt: `${item.resume?.prompt ?? `The owner approved this pitch. Build it.\n\n${item.title}\n\n${item.body_md || item.question}`}\n\n${decided}`,
      start: "reset",
      source: "pitch",
      project: item.resume?.project ?? item.project,
      threadId,
      provider,
    };
  }
  if (!item.resume || item.blocking) return null;
  return {
    title: `Resume: ${item.title || item.question}`,
    prompt: `${item.resume.prompt}\n\n${decided}`,
    start: "when-available",
    source: "resume",
    project: item.resume.project,
    threadId,
    provider,
  };
}

/** 83.4 reads "1:23". */
const seconds = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

const MARK_WORDS: Record<NonNullable<DecisionAnswer["marks"]>[number]["tag"], string> = {
  like: "liked",
  keep: "keep",
  cut: "cut",
  change: "change",
  note: "note",
};

/** "change 0:12-0:31 (too busy)", or "note at 1:04 (logo too small)" for a moment. */
function describeMark(mark: NonNullable<DecisionAnswer["marks"]>[number]): string {
  const when =
    mark.start === mark.end
      ? `at ${seconds(mark.start)}`
      : `${seconds(mark.start)}-${seconds(mark.end)}`;
  return `${MARK_WORDS[mark.tag]} ${when}${mark.note ? ` (${mark.note})` : ""}`;
}

function describeAnswer(item: DecisionItem, answer: DecisionAnswer): string {
  const label = (id: string) => item.options.find((option) => option.id === id)?.label ?? id;
  const parts = [
    answer.option_ids?.length ? answer.option_ids.map(label).join(", ") : null,
    answer.rank?.length ? `ranked ${answer.rank.map(label).join(" > ")}` : null,
    answer.choice,
    answer.retry ? "none of these, try again" : null,
    answer.declined ? "none of these, and don't try again" : null,
    answer.marks?.length ? `marked ${answer.marks.map(describeMark).join(", ")}` : null,
    answer.comment ? `comment: ${answer.comment}` : null,
  ].filter((part) => part !== null && part !== "");
  return parts.length > 0 ? parts.join("; ") : "see the decision";
}

/** A project named by id, workspace path, title, or folder name. */
export function findProject(projects: ReadonlyArray<Project>, name: string): Project | null {
  const live = projects.filter((project) => project.deletedAt === null);
  const lower = name.trim().toLowerCase();
  const folder = (project: Project) =>
    project.workspaceRoot.replace(/\/+$/, "").split("/").pop()?.toLowerCase();
  return (
    live.find((project) => project.id === name || project.workspaceRoot === name) ??
    live.find((project) => project.title.toLowerCase() === lower) ??
    live.find((project) => folder(project) === lower) ??
    null
  );
}

/**
 * The model for a follow-up: the asking thread's (if it's on the named
 * provider), then the project's and the environment's defaults, then the
 * provider's own default model. Saved options the model no longer offers (a
 * "max" variant on a model without one) fall back to its defaults, as the
 * composer does, so the run doesn't fail at the provider.
 */
export function pickModel(input: {
  readonly provider: string | null;
  readonly candidates: ReadonlyArray<ModelSelection | null | undefined>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): ModelSelection | null {
  const fits = (selection: ModelSelection) =>
    input.provider === null || selection.instanceId === input.provider;
  const chosen = input.candidates.find(
    (selection): selection is ModelSelection => selection != null && fits(selection),
  );
  if (chosen) return withOfferedOptions(chosen, input.providers);
  const provider = input.providers.find(
    (candidate) =>
      (input.provider === null || candidate.instanceId === input.provider) &&
      candidate.models.length > 0,
  );
  const model = provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0];
  return provider && model ? { instanceId: provider.instanceId, model: model.slug } : null;
}

function withOfferedOptions(
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const caps = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((model) => model.slug === selection.model)?.capabilities;
  if (!caps || !selection.options?.length) return selection;
  const options = buildExplicitProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({ caps, selections: selection.options }),
    selection.options,
  );
  const { options: _saved, ...rest } = selection;
  return options ? { ...rest, options } : rest;
}

const make = Effect.gen(function* () {
  const decisions = yield* DecisionService.DecisionService;
  const queue = yield* ResetQueueService.ResetQueueService;
  const projects = yield* ProjectService.ProjectService;
  const orchestrator = yield* OrchestratorV2.OrchestratorV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;

  const followUp = Effect.fn("DecisionFollowUps.followUp")(function* (id: string) {
    const { item, answer } = yield* decisions.get(id);
    if (item.status !== "answered" || !answer) return;
    const plan = followUpFor(item, answer);
    if (!plan || (yield* queue.forDecision(item.id))) return;

    const thread = plan.threadId
      ? yield* orchestrator
          .getThreadShell(ThreadId.make(plan.threadId))
          .pipe(Effect.orElseSucceed(() => null))
      : null;
    const { projects: all } = yield* projects.snapshot;
    const project =
      findProject(all, plan.project) ??
      (thread ? (all.find((candidate) => candidate.id === thread.projectId) ?? null) : null);
    if (!project) {
      return yield* Effect.logWarning("No project for a decision follow-up.", {
        decision: item.id,
        project: plan.project,
      });
    }
    const modelSelection = pickModel({
      provider: plan.provider,
      candidates: [
        thread?.modelSelection,
        project.defaultModelSelection,
        (yield* settings.getSettings).defaultModelSelection,
      ],
      providers: yield* registry.getProviders,
    });
    if (!modelSelection) {
      return yield* Effect.logWarning("No model for a decision follow-up.", { decision: item.id });
    }
    const run = yield* queue.enqueue({
      title: plan.title,
      prompt: plan.prompt,
      projectId: project.id,
      modelSelection,
      decisionId: item.id,
      ...(plan.start ? { start: plan.start } : {}),
      ...(plan.source ? { source: plan.source } : {}),
    });
    yield* Effect.logInfo("Queued a decision follow-up.", {
      decision: item.id,
      run: run.id,
      dueReason: run.dueReason,
    });
    if (run.dueReason === "available") yield* queue.startDue;
  });

  const safely = (id: string) =>
    followUp(id).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Decision follow-up failed.", { decision: id, cause }),
      ),
    );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const since = (yield* Clock.currentTimeMillis) - CATCH_UP_MS;
      const recent = yield* decisions.history({ limit: 200 }).pipe(Effect.orElseSucceed(() => []));
      for (const { item } of recent) {
        if ((item.answered_at ?? 0) >= since) yield* safely(item.id);
      }
      yield* Stream.runForEach(decisions.changes, safely);
    }),
  );

  // A thread that was archived or deleted moved on: its open questions go too.
  yield* Effect.forkScoped(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
      event.type === "thread.archived" || event.type === "thread.deleted"
        ? decisions.withdrawForThread(event.payload.id).pipe(
            Effect.tap((count) =>
              count > 0
                ? Effect.logInfo("Withdrew a moved-on thread's decisions.", {
                    thread: event.payload.id,
                    count,
                  })
                : Effect.void,
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Withdrawing a thread's decisions failed.", { cause }),
            ),
          )
        : Effect.void,
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Decision thread watch stopped.", { cause })),
    ),
  );
});

/** Starts follow-ups for answered decisions for as long as the server runs. */
export const layer = Layer.effectDiscard(make);
