/**
 * The machines this terminal has paired with, for `cz` commands that act on
 * another machine (`--host`) and for pairing one without opening the TUI.
 * Reads and writes the same saved connections as the TUI's Hosts tab.
 *
 * @module hosts
 */
import { BearerConnectionProfile, ConnectionOnboarding } from "@cz/client-runtime/connection";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { HostsModule, PairedHost } from "./api.ts";
import * as CatalogFile from "@cz/client-runtime/platform/catalog-file";
import { makeTuiConnectionLayer } from "./runtime/connection.ts";

export type { PairedHost } from "./api.ts";

export const listHosts: HostsModule["listHosts"] = (configDir) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const catalog = yield* (yield* CatalogFile.openInConfigDir(configDir)).read;
      const tokens = new Map(
        catalog.credentials.map((entry) => [entry.connectionId, entry.credential.token]),
      );
      const routes = catalog.profiles
        .filter(
          (profile): profile is BearerConnectionProfile =>
            profile._tag === "BearerConnectionProfile" && profile.authorization === undefined,
        )
        // Paired routes before ones the server reported while connected.
        .toSorted((left, right) => Number(left.learned ?? false) - Number(right.learned ?? false));
      return catalog.targets.flatMap((target): Array<PairedHost> => {
        const route = routes.find(
          (profile) =>
            profile.environmentId === target.environmentId && tokens.has(profile.connectionId),
        );
        if (!route) return [];
        return [
          {
            label: target.label,
            environmentId: target.environmentId,
            httpBaseUrl: route.httpBaseUrl,
            bearerToken: tokens.get(route.connectionId)!,
            enabled: !catalog.disabledEnvironmentIds.includes(target.environmentId),
          },
        ];
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

export const pairHost: HostsModule["pairHost"] = async ({ configDir, pairingUrl, appVersion }) => {
  const runtime = ManagedRuntime.make(
    makeTuiConnectionLayer({ local: null, configDir, appVersion, cwd: process.cwd() }),
  );
  try {
    const environmentId = await runtime.runPromise(
      ConnectionOnboarding.ConnectionOnboarding.pipe(
        Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
      ),
    );
    const host = (await listHosts(configDir)).find(
      (candidate) => candidate.environmentId === environmentId,
    );
    return { environmentId, label: host?.label ?? environmentId };
  } finally {
    await runtime.dispose();
  }
};
