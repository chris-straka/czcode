/**
 * Every recurring job on each connected environment's machine (Schedules).
 *
 * @module state/jobs
 */
import { createJobsEnvironmentAtoms } from "@cz/client-runtime/state/jobs";

import { connectionAtomRuntime } from "../connection/runtime";

export const jobsEnvironment = createJobsEnvironmentAtoms(connectionAtomRuntime);
