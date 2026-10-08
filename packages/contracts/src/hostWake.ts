/**
 * Waking a sleeping agent host (fork): a host that sleeps when idle publishes
 * how to wake it, and any cz server on the same LAN sends the Wake-on-LAN
 * packet when a client asks.
 *
 * @module hostWake
 */
import * as Schema from "effect/Schema";

/** What a sleep-capable host publishes at `/.well-known/cz-wake`. */
export const HostWakeInfo = Schema.Struct({
  hostName: Schema.String,
  mac: Schema.String,
  lanAddress: Schema.String,
  broadcast: Schema.String,
});
export type HostWakeInfo = typeof HostWakeInfo.Type;

export const WakeHostInput = Schema.Struct({
  /** The host's tailnet name, MagicDNS name, Tailscale IP, or LAN address. */
  host: Schema.String,
});
export type WakeHostInput = typeof WakeHostInput.Type;

export const WakeHostResult = Schema.Struct({
  /** False when this server doesn't know the host or isn't on its LAN. */
  sent: Schema.Boolean,
  hostName: Schema.NullOr(Schema.String),
});
export type WakeHostResult = typeof WakeHostResult.Type;

/** Tailnet peers a server sees online, so clients can tell a busy machine from a sleeping one. */
export const OnlinePeers = Schema.Struct({
  peers: Schema.Array(
    Schema.Struct({
      hostName: Schema.String,
      /** MagicDNS name without the trailing dot. */
      dnsName: Schema.String,
      tailscaleIps: Schema.Array(Schema.String),
    }),
  ),
});
export type OnlinePeers = typeof OnlinePeers.Type;
