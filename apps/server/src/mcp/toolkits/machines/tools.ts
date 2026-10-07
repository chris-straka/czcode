import {
  Machine,
  MachineEnqueueInput,
  MachineError,
  OrchestratorMcpFailure,
  QueuedRun,
} from "@cz/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as MachineDirectory from "../../../machines/MachineDirectory.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  MachineDirectory.MachineDirectory,
];
const failure = Schema.Union([MachineError, OrchestratorMcpFailure]);

const MachineListTool = Tool.make("cz_machine_list", {
  description:
    "List the cz machines on the owner's tailnet: this one (self), the ones this machine is signed in to (signedIn, so cz_machine_queue can start work there), and cz servers found but not signed in. online is whether it answered just now. Use it to spread work across machines.",
  success: Schema.Struct({ machines: Schema.Array(Machine) }),
  failure,
  dependencies,
})
  .annotate(Tool.Title, "List machines")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MachineQueueTool = Tool.make("cz_machine_queue", {
  description:
    'Start or queue a task as a new thread on a machine from cz_machine_list (or this one), the way `cz queue add --host` does. project is a project id, workspace path, or title on that machine. run.start "when-available" starts it now when the model has quota; omitted, it waits for the model\'s next quota reset (or run.dueAt). The machine needs the project and the provider set up. Returns the queued run; its threadId appears once it starts.',
  parameters: MachineEnqueueInput,
  success: Schema.Struct({ machine: Schema.String, run: QueuedRun }),
  failure,
  dependencies,
})
  .annotate(Tool.Title, "Queue work on a machine")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const MachinesToolkit = Toolkit.make(MachineListTool, MachineQueueTool);
