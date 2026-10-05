/**
 * client-runtime's platform services for a terminal: no cz Connect, no SSH,
 * always "online" (the socket's own reconnects cover drops), and the local
 * server registered from the session `cz tui` minted for it.
 *
 * @module platform
 */
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  ConnectionBlockedError,
  Connectivity,
  mapRemoteEnvironmentError,
  Wakeups,
} from "@cz/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@cz/client-runtime/environment";
import { ClientCapabilities, PlatformConnectionSource } from "@cz/client-runtime/platform";
import { AuthStandardClientScopes } from "@cz/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import type { LocalServer } from "../api.ts";

export const LOCAL_CONNECTION_ID = "local:cz-tui";

export function wsBaseUrlFor(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}

const unsupported = (detail: string) =>
  Effect.fail(new ConnectionBlockedError({ reason: "unsupported", detail }));

export const capabilitiesLayer = (appVersion: string) =>
  Layer.succeedContext(
    Context.make(
      ClientCapabilities.CloudSession,
      ClientCapabilities.CloudSession.of({
        identity: Effect.succeedNone,
        clerkToken: unsupported("cz Connect isn't available in the terminal app."),
      }),
    ).pipe(
      Context.add(
        ClientCapabilities.PrimaryEnvironmentAuth,
        ClientCapabilities.PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeedNone }),
      ),
      Context.add(
        ClientCapabilities.RelayDeviceIdentity,
        ClientCapabilities.RelayDeviceIdentity.of({ deviceId: Effect.succeedNone }),
      ),
      Context.add(
        ClientCapabilities.ClientPresentation,
        ClientCapabilities.ClientPresentation.of({
          metadata: {
            label: "czcode terminal",
            deviceType: "desktop",
            surface: "cli",
            ...(appVersion ? { appVersion } : {}),
          },
          scopes: AuthStandardClientScopes,
        }),
      ),
      Context.add(
        ClientCapabilities.SshEnvironmentGateway,
        ClientCapabilities.SshEnvironmentGateway.of({
          provision: () => unsupported("SSH environments are only available in the desktop app."),
          prepare: () => unsupported("SSH environments are only available in the desktop app."),
          disconnect: () => Effect.void,
        }),
      ),
    ),
  );

export const connectivityLayer = Connectivity.layer({
  status: Effect.succeed("online"),
  changes: Stream.never,
});

export const wakeupsLayer = Wakeups.layer({ changes: Stream.never });

/** Registers the local server, if `cz tui` found one, as a platform-managed connection. */
export const platformSourceLayer = (local: LocalServer | null) =>
  Layer.effect(
    PlatformConnectionSource.PlatformConnectionSource,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const registrations =
        local === null
          ? Stream.make([])
          : Stream.fromEffect(
              fetchRemoteEnvironmentDescriptor({ httpBaseUrl: local.httpBaseUrl }).pipe(
                Effect.mapError(mapRemoteEnvironmentError),
                Effect.provideService(HttpClient.HttpClient, httpClient),
                Effect.map((descriptor) => {
                  const shared = {
                    environmentId: descriptor.environmentId,
                    label: local.label || descriptor.label,
                    connectionId: LOCAL_CONNECTION_ID,
                  };
                  return [
                    new BearerConnectionRegistration({
                      target: new BearerConnectionTarget(shared),
                      profile: new BearerConnectionProfile({
                        ...shared,
                        httpBaseUrl: local.httpBaseUrl,
                        wsBaseUrl: wsBaseUrlFor(local.httpBaseUrl),
                      }),
                      credential: new BearerConnectionCredential({ token: local.bearerToken }),
                    }),
                  ];
                }),
                Effect.catch((error) =>
                  Effect.logWarning("Could not reach the local cz server.", { error }).pipe(
                    Effect.as([]),
                  ),
                ),
              ),
            );
      return PlatformConnectionSource.PlatformConnectionSource.of({ registrations });
    }),
  );
