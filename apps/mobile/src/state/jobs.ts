/**
 * Every recurring job on each connected environment's machine (Schedules).
 *
 * @module state/jobs
 */
import { useAtomValue } from "@effect/atom-react";
import { createJobsEnvironmentAtoms, jobsAcrossKey } from "@cz/client-runtime/state/jobs";
import type { EnvironmentId } from "@cz/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

export const jobsEnvironment = createJobsEnvironmentAtoms(connectionAtomRuntime);

/** Every job on the given machines, as far as each has answered. */
export function useJobsOn(environmentIds: ReadonlyArray<EnvironmentId>) {
  return useAtomValue(jobsEnvironment.across(jobsAcrossKey(environmentIds)));
}
