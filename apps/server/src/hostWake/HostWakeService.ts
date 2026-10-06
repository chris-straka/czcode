/**
 * Wakes sleeping agent hosts over the LAN. A host that sleeps when idle
 * (HostSleepService) publishes its MAC at `/.well-known/cz-wake`; every cz
 * server reads that from its online tailnet peers every few minutes and keeps
 * what it learned, so it can still send the Wake-on-LAN packet once the host
 * is asleep. Clients ask any connected server to wake a host they can't reach.
 *
 * @module HostWakeService
 */
import * as NodeDgram from "node:dgram";
import * as NodeOS from "node:os";

import { HostWakeInfo, type WakeHostResult } from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  findWakeEntry,
  magicPacket,
  onlineTailscalePeers,
  type WakeEntry,
  wakeInterface,
} from "./wake.ts";

const LEARN_INTERVAL = Duration.minutes(5);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const sleepMinutesConfig = Config.Int("CZ_SLEEP_WHEN_IDLE_MINUTES").pipe(Config.option);

const WakeEntries = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      ...HostWakeInfo.fields,
      dnsName: Schema.String,
      tailscaleIps: Schema.Array(Schema.String),
      learnedAt: Schema.Number,
    }),
  ),
);

export class HostWakeService extends Context.Service<
  HostWakeService,
  {
    /** How to wake this machine, when it sleeps when idle; published to the tailnet. */
    readonly ownWakeInfo: Option.Option<HostWakeInfo>;
    readonly wake: (host: string) => Effect.Effect<WakeHostResult>;
  }
>()("cz/hostWake/HostWakeService") {}

const sendMagicPacket = (entry: WakeEntry) =>
  Effect.callback<void, Error>((resume) => {
    const socket = NodeDgram.createSocket("udp4");
    const packet = magicPacket(entry.mac);
    const targets = [entry.broadcast, "255.255.255.255"];
    let pending = targets.length;
    socket.once("error", (error) => {
      socket.close();
      resume(Effect.fail(error));
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      for (const target of targets) {
        socket.send(packet, 9, target, () => {
          if (--pending === 0) {
            socket.close();
            resume(Effect.void);
          }
        });
      }
    });
  });

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  const httpClient = yield* HttpClient.HttpClient;
  const storePath = path.join(config.stateDir, "wake-hosts.json");

  const sleepMinutes = Option.getOrElse(
    yield* sleepMinutesConfig.pipe(Effect.orElseSucceed(() => Option.none<number>())),
    () => 0,
  );
  const ownInterface = sleepMinutes > 0 ? wakeInterface(NodeOS.networkInterfaces()) : null;
  const ownWakeInfo: Option.Option<HostWakeInfo> = ownInterface
    ? Option.some({ hostName: NodeOS.hostname(), ...ownInterface })
    : Option.none();

  const readEntries = fs.readFileString(storePath).pipe(
    Effect.flatMap(Schema.decodeEffect(WakeEntries)),
    Effect.orElseSucceed((): ReadonlyArray<WakeEntry> => []),
  );

  const fetchWakeInfo = (dnsName: string) =>
    httpClient
      .get(`https://${dnsName}/.well-known/cz-wake`)
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(HostWakeInfo)),
        Effect.timeout("5 seconds"),
        Effect.option,
      );

  /** Refreshes what we know about each online peer that publishes wake details. */
  const learn = Effect.gen(function* () {
    const status = yield* processes.run({
      command: "tailscale",
      args: ["status", "--json"],
      timeout: "10 seconds",
    });
    if (status.code !== 0) return;
    const peers = onlineTailscalePeers(yield* decodeJson(status.stdout));
    const now = yield* Clock.currentTimeMillis;
    const learned = yield* Effect.forEach(
      peers,
      (peer) =>
        fetchWakeInfo(peer.dnsName).pipe(
          Effect.map(
            Option.map((info): WakeEntry => ({
              ...info,
              dnsName: peer.dnsName,
              tailscaleIps: peer.tailscaleIps,
              learnedAt: now,
            })),
          ),
        ),
      { concurrency: 4 },
    ).pipe(Effect.map((results) => results.flatMap(Option.toArray)));
    if (learned.length === 0) return;
    const kept = (yield* readEntries).filter(
      (entry) => !learned.some((fresh) => fresh.dnsName === entry.dnsName),
    );
    yield* fs.writeFileString(
      storePath,
      yield* Schema.encodeEffect(WakeEntries)([...kept, ...learned]),
    );
  }).pipe(Effect.catch((error) => Effect.logDebug("Learning wake hosts failed", error)));

  yield* Effect.forkScoped(
    Effect.forever(learn.pipe(Effect.andThen(Effect.sleep(LEARN_INTERVAL)))),
  );

  const wake = (host: string) =>
    Effect.gen(function* () {
      const entry = findWakeEntry(yield* readEntries, host);
      if (!entry) return { sent: false, hostName: null };
      yield* sendMagicPacket(entry);
      yield* Effect.logInfo("Sent Wake-on-LAN", { host: entry.hostName, mac: entry.mac });
      return { sent: true, hostName: entry.hostName };
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Wake-on-LAN failed", error).pipe(
          Effect.as({ sent: false, hostName: null }),
        ),
      ),
    );

  return HostWakeService.of({ ownWakeInfo, wake });
});

export const layer = Layer.effect(HostWakeService, make).pipe(Layer.provide(ProcessRunner.layer));
