/**
 * The machine list on a cz server: the machines saved in this computer's
 * shared machine list (the one `cz host`, the terminal app, and the desktop
 * app use) plus the cz servers answering among its online Tailscale peers.
 *
 * It also lets a device sign in to a machine without copying links. A device
 * already signed in here asks for a pairing link to another machine; this
 * server mints a one-time token there with the credential it saved, and the
 * device redeems it itself, so it gets its own token that can be revoked
 * alone. The same introduction signs this computer in (`pair`).
 *
 * @module MachineDirectory
 */
import {
  type AuthPairingCredentialResult,
  EnvironmentHttpApi,
  ExecutionEnvironmentDescriptor,
  type Machine,
  type MachineEnqueueInput,
  MachineError,
  type MachinePairingLinkInput,
  type MachinePairingLinkResult,
  type MachinePairResult,
  type QueuedRun,
} from "@cz/contracts";
import type { HostsModule } from "@cz/tui/api";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import packageJson from "../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { loadHosts, machineListDir } from "../cli/serverClient.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { onlineTailscalePeers } from "../hostWake/wake.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ResetQueueService from "../resetQueue/ResetQueueService.ts";
import { buildPairingUrl } from "../startupAccess.ts";
import { findMachine, type FoundMachine, mergeMachines, type SavedMachine } from "./machines.ts";

const DISCOVERY_TTL = Duration.seconds(30);
const PROBE_TIMEOUT = Duration.seconds(4);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export class MachineDirectory extends Context.Service<
  MachineDirectory,
  {
    readonly list: Effect.Effect<ReadonlyArray<Machine>>;
    /** A one-time link that signs a device in to `environmentId`. */
    readonly pairingLink: (
      input: MachinePairingLinkInput,
    ) => Effect.Effect<MachinePairingLinkResult, MachineError>;
    /** Saves a machine to this computer's list from a pairing link, or by introduction. */
    readonly pair: (
      input: { readonly pairingUrl: string } | { readonly machine: string },
    ) => Effect.Effect<MachinePairResult, MachineError>;
    /** Queues (or, with `start: "when-available"`, starts) work on a machine. */
    readonly enqueue: (
      input: MachineEnqueueInput,
    ) => Effect.Effect<{ readonly machine: string; readonly run: QueuedRun }, MachineError>;
  }
>()("cz/machines/MachineDirectory") {}

const machineError = (message: string) => new MachineError({ message });
const describe = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);

const make = Effect.gen(function* () {
  const processes = yield* ProcessRunner.ProcessRunner;
  const httpClient = yield* HttpClient.HttpClient;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const projects = yield* ProjectService.ProjectService;
  const queue = yield* ResetQueueService.ResetQueueService;

  const withHosts = <A>(use: (hosts: HostsModule, configDir: string) => Promise<A>) =>
    machineListDir.pipe(
      Effect.flatMap((configDir) =>
        Effect.tryPromise({
          try: async () => use(await loadHosts(), configDir),
          catch: (cause) => machineError(describe(cause)),
        }),
      ),
    );

  const saved: Effect.Effect<ReadonlyArray<SavedMachine>, MachineError> = withHosts(
    (hosts, configDir) => hosts.listHosts(configDir),
  );

  const probe = (dnsName: string) =>
    httpClient.get(`https://${dnsName}/.well-known/cz/environment`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
      Effect.timeout(PROBE_TIMEOUT),
      Effect.map((descriptor): FoundMachine => ({ httpBaseUrl: `https://${dnsName}`, descriptor })),
      Effect.option,
    );

  /** cz servers among the online tailnet peers, and this machine's tailnet URL. */
  const discover = Effect.gen(function* () {
    const status = yield* processes.run({
      command: "tailscale",
      args: ["status", "--json"],
      timeout: "10 seconds",
    });
    if (status.code !== 0) return { found: [], selfUrl: null };
    const json = yield* decodeJson(status.stdout);
    const selfDns = (json as { Self?: { DNSName?: unknown } } | null)?.Self?.DNSName;
    const found = yield* Effect.forEach(onlineTailscalePeers(json), (peer) => probe(peer.dnsName), {
      concurrency: 8,
    });
    return {
      found: found.flatMap(Option.toArray),
      selfUrl:
        typeof selfDns === "string" && selfDns ? `https://${selfDns.replace(/\.$/, "")}` : null,
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.logDebug("Looking for machines on the tailnet failed", error).pipe(
        Effect.as({ found: [] as ReadonlyArray<FoundMachine>, selfUrl: null }),
      ),
    ),
  );
  const discoverCached = yield* Effect.cachedWithTTL(discover, DISCOVERY_TTL);

  const list = Effect.gen(function* () {
    const [{ found, selfUrl }, savedMachines, self] = yield* Effect.all(
      [
        discoverCached,
        saved.pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not read this computer's machine list", error).pipe(
              Effect.as([] as ReadonlyArray<SavedMachine>),
            ),
          ),
        ),
        serverEnvironment.getDescriptor,
      ],
      { concurrency: "unbounded" },
    );
    return mergeMachines({ self, selfUrl, saved: savedMachines, found });
  });

  const clientFor = (machine: SavedMachine) =>
    HttpApiClient.make(EnvironmentHttpApi, { baseUrl: machine.httpBaseUrl }).pipe(
      Effect.map((client) => ({
        client,
        headers: { authorization: `Bearer ${machine.bearerToken}` },
      })),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const savedMachine = (wanted: string) =>
    Effect.gen(function* () {
      const machines = yield* saved;
      const machine = findMachine(machines, wanted);
      if (machine) return machine;
      const known = machines.map((entry) => entry.label).join(", ") || "none";
      return yield* machineError(
        `This computer isn't signed in to ${wanted} (signed in to: ${known}).`,
      );
    });

  const linkResult = (httpBaseUrl: string, issued: AuthPairingCredentialResult) => ({
    pairingUrl: buildPairingUrl(httpBaseUrl, issued.credential),
    expiresAt: DateTime.formatIso(issued.expiresAt),
  });

  const pairingLink: MachineDirectory["Service"]["pairingLink"] = (input) =>
    Effect.gen(function* () {
      const self = yield* serverEnvironment.getDescriptor;
      if (input.environmentId === self.environmentId) {
        const { selfUrl } = yield* discoverCached;
        if (!selfUrl)
          return yield* machineError("This machine has no tailnet address to pair through.");
        const issued = yield* auth
          .issuePairingCredential(input.label ? { label: input.label } : undefined)
          .pipe(Effect.mapError((error) => machineError(error.message)));
        return linkResult(selfUrl, issued);
      }
      const machine = yield* savedMachine(input.environmentId);
      const { client, headers } = yield* clientFor(machine);
      const issued = yield* client.auth
        .pairingCredential({ headers, payload: input.label ? { label: input.label } : {} })
        .pipe(
          Effect.mapError((error) =>
            machineError(
              `${machine.label} wouldn't make a pairing link (${describe(error)}). It may need updating, or this computer's sign-in there was revoked.`,
            ),
          ),
        );
      return linkResult(machine.httpBaseUrl, issued);
    });

  const pairWithLink = (pairingUrl: string) =>
    withHosts((hosts, configDir) =>
      hosts.pairHost({ configDir, pairingUrl, appVersion: packageJson.version }),
    ).pipe(
      Effect.map(({ environmentId, label }) => ({
        environmentId: environmentId as MachinePairResult["environmentId"],
        label,
      })),
    );

  /** Asks each machine this computer is signed in to for a link to `wanted`. */
  const introduce = (wanted: string) =>
    Effect.gen(function* () {
      const machines = yield* list;
      const target = findMachine(machines, wanted);
      if (!target) return yield* machineError(`No machine called ${wanted} on the tailnet.`);
      if (target.signedIn) return { environmentId: target.environmentId, label: target.label };
      const self = yield* serverEnvironment.getDescriptor;
      const introducers = (yield* saved).filter(
        (entry) => entry.environmentId !== target.environmentId,
      );
      for (const introducer of introducers) {
        const link = yield* Effect.gen(function* () {
          const { client, headers } = yield* clientFor(introducer);
          const theirs = yield* client.machines.list({ headers });
          if (
            !theirs.machines.some(
              (entry) => entry.environmentId === target.environmentId && entry.signedIn,
            )
          ) {
            return Option.none<MachinePairingLinkResult>();
          }
          return Option.some(
            yield* client.machines.pairingLink({
              headers,
              payload: { environmentId: target.environmentId, label: self.label },
            }),
          );
        }).pipe(
          Effect.catch((error) =>
            Effect.logDebug(`${introducer.label} couldn't introduce ${target.label}`, error).pipe(
              Effect.as(Option.none<MachinePairingLinkResult>()),
            ),
          ),
        );
        if (Option.isSome(link)) return yield* pairWithLink(link.value.pairingUrl);
      }
      return yield* machineError(
        `None of the machines this computer is signed in to could sign it in to ${target.label}. Pair it once with \`cz pair --tailscale\` on ${target.label} and \`cz host add <link>\` here.`,
      );
    });

  const pair: MachineDirectory["Service"]["pair"] = (input) =>
    "pairingUrl" in input ? pairWithLink(input.pairingUrl) : introduce(input.machine);

  const enqueue: MachineDirectory["Service"]["enqueue"] = (input) =>
    Effect.gen(function* () {
      const self = yield* serverEnvironment.getDescriptor;
      const isSelf =
        input.machine === self.environmentId ||
        input.machine.toLowerCase() === self.label.toLowerCase();
      const pickProject = <
        P extends {
          readonly id: string;
          readonly workspaceRoot: string;
          readonly title: string;
          readonly deletedAt: unknown;
        },
      >(
        candidates: ReadonlyArray<P>,
        where: string,
      ) =>
        Effect.gen(function* () {
          const live = candidates.filter((project) => project.deletedAt === null);
          const project =
            live.find((candidate) => candidate.id === input.project) ??
            live.find((candidate) => candidate.workspaceRoot === input.project) ??
            live.find((candidate) => candidate.title.toLowerCase() === input.project.toLowerCase());
          if (project) return project;
          return yield* machineError(
            `No project ${input.project} on ${where}. Its projects: ${live.map((entry) => entry.title).join(", ") || "none"}.`,
          );
        });
      if (isSelf) {
        const snapshot = yield* projects.snapshot.pipe(
          Effect.mapError((error) => machineError(describe(error))),
        );
        const project = yield* pickProject(snapshot.projects, self.label);
        const run = yield* queue
          .enqueue({ ...input.run, projectId: project.id as QueuedRun["projectId"] })
          .pipe(Effect.mapError((error) => machineError(error.message)));
        return { machine: self.label, run };
      }
      const machine = yield* savedMachine(input.machine);
      const { client, headers } = yield* clientFor(machine);
      const snapshot = yield* client.projects
        .snapshot({ headers })
        .pipe(Effect.mapError((error) => machineError(`${machine.label}: ${describe(error)}`)));
      const project = yield* pickProject(snapshot.projects, machine.label);
      const run = yield* client.queue
        .enqueue({ headers, payload: { ...input.run, projectId: project.id } })
        .pipe(Effect.mapError((error) => machineError(`${machine.label}: ${describe(error)}`)));
      return { machine: machine.label, run };
    });

  return MachineDirectory.of({ list, pairingLink, pair, enqueue });
});

export const layer = Layer.effect(MachineDirectory, make).pipe(Layer.provide(ProcessRunner.layer));
