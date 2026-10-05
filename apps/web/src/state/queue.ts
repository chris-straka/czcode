/**
 * The reset queue on each connected environment: runs that start as threads
 * when their model's quota resets ("Run at next reset").
 *
 * @module state/queue
 */
import { createQueueEnvironmentAtoms } from "@cz/client-runtime/state/queue";

import { connectionAtomRuntime } from "../connection/runtime";

export const queueEnvironment = createQueueEnvironmentAtoms(connectionAtomRuntime);
