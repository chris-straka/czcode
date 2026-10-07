/**
 * The machine list (fork): every cz server on the user's tailnet, whether or
 * not this client has signed in to it. A server lists the machines it saved
 * (in its computer's shared machine list) and the cz servers it found among
 * its online Tailscale peers. A client signs in to a found machine by asking
 * a server that already holds a credential for it to mint a one-time pairing
 * token there, then redeems it itself, so every device keeps its own token.
 *
 * @module machines
 */
import * as Schema from "effect/Schema";

import { EnvironmentId } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { QueuedRunInput } from "./resetQueue.ts";

export const Machine = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  /** Where this server reaches it; for a found machine, its tailnet HTTPS URL. */
  httpBaseUrl: Schema.String,
  platform: Schema.optionalKey(ExecutionEnvironmentDescriptor.fields.platform),
  /** Answered on the tailnet during the last look. */
  online: Schema.Boolean,
  /** This server holds a credential for it, so it can sign other devices in. */
  signedIn: Schema.Boolean,
  /** The server answering. */
  self: Schema.Boolean,
});
export type Machine = typeof Machine.Type;

export const MachineListResult = Schema.Struct({ machines: Schema.Array(Machine) });
export type MachineListResult = typeof MachineListResult.Type;

export const MachinePairingLinkInput = Schema.Struct({
  environmentId: EnvironmentId,
  /** Shown in the target machine's Connections list for the device it signs in. */
  label: Schema.optionalKey(Schema.String),
});
export type MachinePairingLinkInput = typeof MachinePairingLinkInput.Type;

export const MachinePairingLinkResult = Schema.Struct({
  /** One-time `https://<machine>/pair#token=…` link; redeem it at that machine. */
  pairingUrl: Schema.String,
  expiresAt: Schema.String,
});
export type MachinePairingLinkResult = typeof MachinePairingLinkResult.Type;

/** A pairing link to redeem, or a machine to be introduced to by one already signed in. */
export const MachinePairInput = Schema.Union([
  Schema.Struct({ pairingUrl: Schema.String }),
  Schema.Struct({ machine: Schema.String }),
]);
export type MachinePairInput = typeof MachinePairInput.Type;

export const MachinePairResult = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
});
export type MachinePairResult = typeof MachinePairResult.Type;

/** Queue or start work on another machine this server is signed in to. */
export const MachineEnqueueInput = Schema.Struct({
  /** Label, environment id, or tailnet name of the machine. */
  machine: Schema.String,
  /** Project id, workspace path on that machine, or project title there. */
  project: Schema.String,
  run: QueuedRunInput.mapFields(({ projectId: _projectId, ...fields }) => fields),
});
export type MachineEnqueueInput = typeof MachineEnqueueInput.Type;

export class MachineError extends Schema.TaggedError<MachineError>()(
  "MachineError",
  { message: Schema.String },
  { httpApiStatus: 502 },
) {}
