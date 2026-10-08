/**
 * Every recurring job on each environment's machine, for the Schedules view:
 * cz's scheduled tasks and the timers registered in the host's jobs.toml.
 *
 * @module state/jobs
 */
import { type ScheduleJob, type ScheduleJobRun, scheduleJobFailing } from "@cz/contracts";
import { formatDuration } from "@cz/shared/usageLimits";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { EnvironmentHttpConnectionNotReadyError } from "./pullRequests.ts";
import { createEnvironmentQueryAtomFamily } from "./runtime.ts";

/** Reading systemd and the journal takes a moment; jobs change at most every few minutes. */
const JOBS_REFRESH_INTERVAL_MS = 5 * 60_000;

export class JobsHttpClient extends Context.Service<
  JobsHttpClient,
  {
    readonly list: (
      prepared: PreparedConnection,
    ) => Effect.Effect<ReadonlyArray<ScheduleJob>, RemoteEnvironmentRequestError>;
  }
>()("@cz/client-runtime/state/jobs/JobsHttpClient") {}

export const layer: Layer.Layer<JobsHttpClient, never, HttpClient.HttpClient> = Layer.effect(
  JobsHttpClient,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    return JobsHttpClient.of({
      list: (prepared) =>
        executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "jobs",
          timeoutMs: 30_000,
          method: "GET",
          url: (base) => makeEnvironmentHttpApiUrlBuilder(base).jobs.list(),
          request: ({ client, headers }) => client.list({ headers }),
        }).pipe(
          Effect.map((result) => result.jobs),
          Effect.provideService(HttpClient.HttpClient, httpClient),
        ),
    });
  }),
);

/** The jobs list per environment. */
export function createJobsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | JobsHttpClient | R, E>,
) {
  return {
    list: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:jobs:list",
      staleTimeMs: 60_000,
      refreshIntervalMs: JOBS_REFRESH_INTERVAL_MS,
      execute: (_: null) =>
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
          const client = yield* JobsHttpClient;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          if (Option.isNone(prepared)) {
            return yield* new EnvironmentHttpConnectionNotReadyError({
              message: "The environment HTTP connection is not ready.",
            });
          }
          return yield* client.list(prepared.value);
        }),
    }),
  };
}

/**
 * Jobs in the order the owner reads them: failing first, then needing
 * attention, then the rest by next run.
 */
export function sortScheduleJobs(jobs: ReadonlyArray<ScheduleJob>): ScheduleJob[] {
  const rank = (job: ScheduleJob) =>
    scheduleJobFailing(job) ? 0 : job.lastRun.status === "attention" ? 1 : job.registered ? 2 : 3;
  return [...jobs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER),
  );
}

const STATUS_WORD: Record<ScheduleJobRun["status"], string> = {
  ok: "OK",
  attention: "Needs you",
  failed: "Failed",
  running: "Running",
  never: "Never run",
};

/** "Failed 6h 12m ago", "OK 2d 3h ago", "Running", "Never run". */
export function scheduleJobRunLabel(run: ScheduleJobRun, now: number): string {
  const word = STATUS_WORD[run.status];
  if (run.at === null || run.status === "running" || run.status === "never") return word;
  return `${word} ${formatDuration(now - run.at)} ago`;
}

/** "in 9h 40m", or null when nothing is scheduled. */
export function scheduleJobNextRunLabel(job: ScheduleJob, now: number): string | null {
  if (job.nextRunAt === null) return null;
  return job.nextRunAt <= now ? "due now" : `in ${formatDuration(job.nextRunAt - now)}`;
}
