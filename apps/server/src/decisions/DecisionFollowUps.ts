/**
 * What happens after the owner answers (ccez/DECISIONS.md): an approved pitch
 * becomes a task for the next quota reset, and an answer to an agent that
 * moved on (non-blocking, with a resume plan) starts a resume thread with the
 * decision attached, through the reset queue when the quota is spent.
 *
 * Each decision gets one run at most (the queue keys runs by decision), and
 * the last day's answers are re-checked on boot so a restart loses none.
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
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as OrchestratorV2 from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
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

function describeAnswer(item: DecisionItem, answer: DecisionAnswer): string {
  const label = (id: string) => item.options.find((option) => option.id === id)?.label ?? id;
  const parts = [
    answer.option_ids?.length ? answer.option_ids.map(label).join(", ") : null,
    answer.rank?.length ? `ranked ${answer.rank.map(label).join(" > ")}` : null,
    answer.choice,
    answer.retry ? "none of these, try again" : null,
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
 * provider's own default model.
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
  if (chosen) return chosen;
  const provider = input.providers.find(
    (candidate) =>
      (input.provider === null || candidate.instanceId === input.provider) &&
      candidate.models.length > 0,
  );
  const model = provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0];
  return provider && model ? { instanceId: provider.instanceId, model: model.slug } : null;
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
});

/** Starts follow-ups for answered decisions for as long as the server runs. */
export const layer = Layer.effectDiscard(make);
