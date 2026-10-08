/**
 * HTTP transport for the Schedules view (`/api/jobs`).
 *
 * @module ScheduleJobsHttp
 */
import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@cz/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as ScheduleJobsService from "./ScheduleJobsService.ts";

export const jobsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "jobs",
  Effect.fnUntraced(function* (handlers) {
    const jobs = yield* ScheduleJobsService.ScheduleJobsService;
    return handlers.handle("list", (args) =>
      Effect.gen(function* () {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationReadScope);
        return yield* jobs.list;
      }),
    );
  }),
);
