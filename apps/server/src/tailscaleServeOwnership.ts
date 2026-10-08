/**
 * Who a Tailscale Serve HTTPS port belongs to, decided from the machine's own
 * Serve config instead of a round trip over the tailnet (which can time out
 * on a hairpin and look like "nothing there").
 *
 * Serve config is machine-wide and keyed by port, while `tailscale serve
 * --https=<port> off` removes whatever the port points at. So a server may
 * only configure a port that is free, stale, or already its own, and may only
 * turn off a port that still points at it. Anything else would take the route
 * from the machine's running host (a dev server or `cz pair` started inside an
 * agent inherits the host's CZ_TAILSCALE_SERVE).
 *
 * @module tailscaleServeOwnership
 */
import { type EnvironmentId, ExecutionEnvironmentDescriptor } from "@cz/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/cz/environment";
const PROBE_TIMEOUT = Duration.millis(2_500);

/**
 * Three outcomes, because they drive different decisions: a cz descriptor,
 * nothing answering (safe to point Serve here), or something answering that
 * is not a cz server (never overwrite its mapping).
 */
export type EnvironmentProbeResult =
  | { readonly _tag: "descriptor"; readonly descriptor: ExecutionEnvironmentDescriptor }
  | { readonly _tag: "unreachable" }
  | { readonly _tag: "not-a-cz-server" };

export const probeEnvironmentDescriptor = (
  baseUrl: string,
): Effect.Effect<EnvironmentProbeResult, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(new URL(WELL_KNOWN_ENVIRONMENT_PATH, baseUrl).toString());
    const response = yield* client.execute(request).pipe(
      Effect.timeout(PROBE_TIMEOUT),
      // Transport failure or timeout: nothing (reachable) is listening there.
      Effect.mapError(() => ({ _tag: "unreachable" }) as const),
    );
    // Bad-gateway family means a proxy answered for a backend that is gone.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return { _tag: "unreachable" } as const;
    }
    const descriptor = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
      Effect.mapError(() => ({ _tag: "not-a-cz-server" }) as const),
    );
    return { _tag: "descriptor", descriptor } as const;
  }).pipe(Effect.catch((outcome) => Effect.succeed(outcome)));

export type ServePortOwner =
  /** Nothing is served on the port. */
  | { readonly _tag: "free" }
  /** It points at this server, or at another port of the same environment. */
  | { readonly _tag: "ours" }
  /** It points at a local server that no longer answers: safe to repoint. */
  | { readonly _tag: "stale"; readonly proxy: string }
  /** A live cz server for a different environment owns it. */
  | { readonly _tag: "other-environment"; readonly proxy: string }
  /** Something that isn't a cz server owns it. */
  | { readonly _tag: "occupied"; readonly proxy: string };

/** Whether two URLs share an origin; false for anything unparseable. */
export const sameOrigin = (left: string, right: string) => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

/** The owner of a port from where Serve points it and what answers there. Pure. */
export function decideServePortOwner(input: {
  readonly proxy: string | null;
  readonly ownLocalUrl: string;
  readonly ownEnvironmentId: EnvironmentId;
  readonly probe: EnvironmentProbeResult | null;
}): ServePortOwner {
  const { proxy, probe } = input;
  if (proxy === null) return { _tag: "free" };
  if (sameOrigin(proxy, input.ownLocalUrl)) return { _tag: "ours" };
  if (probe === null || probe._tag === "unreachable") return { _tag: "stale", proxy };
  if (probe._tag === "not-a-cz-server") return { _tag: "occupied", proxy };
  return probe.descriptor.environmentId === input.ownEnvironmentId
    ? { _tag: "ours" }
    : { _tag: "other-environment", proxy };
}

/** Reads the port's owner: Serve's own config, then a local probe of whatever it points at. */
export const resolveServePortOwner = (input: {
  readonly proxy: string | null;
  readonly ownLocalUrl: string;
  readonly ownEnvironmentId: EnvironmentId;
}) =>
  Effect.gen(function* () {
    const probe =
      input.proxy === null || sameOrigin(input.proxy, input.ownLocalUrl)
        ? null
        : yield* probeEnvironmentDescriptor(input.proxy);
    return decideServePortOwner({ ...input, probe });
  });
