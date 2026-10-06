/**
 * Wake-on-LAN pieces behind HostWakeService, kept pure for tests.
 *
 * @module hostWakeRules
 */
import type { HostWakeInfo } from "@cz/contracts";
import type { NetworkInterfaceInfo } from "node:os";

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Virtual interfaces never carry a Wake-on-LAN packet to this machine.
const VIRTUAL_INTERFACE = /^(lo|tailscale|docker|br-|veth|virbr|utun|wg)/;

/** The LAN address, MAC, and broadcast of the wired (or first real) interface. */
export function wakeInterface(
  interfaces: NodeJS.Dict<ReadonlyArray<NetworkInterfaceInfo>>,
): Omit<HostWakeInfo, "hostName"> | null {
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !VIRTUAL_INTERFACE.test(name))
    .flatMap(([name, infos]) =>
      (infos ?? [])
        .filter((info) => info.family === "IPv4" && !info.internal)
        .filter((info) => PRIVATE_IPV4.test(info.address))
        .map((info) => ({ name, info })),
    )
    // Wired first: Wake-on-LAN only works over Ethernet.
    .toSorted((left, right) => Number(isWired(right.name)) - Number(isWired(left.name)));
  const chosen = candidates[0];
  if (!chosen) return null;
  return {
    mac: chosen.info.mac,
    lanAddress: chosen.info.address,
    broadcast: broadcastAddress(chosen.info.address, chosen.info.netmask),
  };
}

const isWired = (name: string) => /^(en|eth)/.test(name) && !/^en\d+$/.test(name);

export function broadcastAddress(address: string, netmask: string): string {
  const octets = address.split(".").map(Number);
  const mask = netmask.split(".").map(Number);
  return octets.map((octet, index) => (octet | (~(mask[index] ?? 0) & 255)) & 255).join(".");
}

/** Six 0xff bytes, then the MAC sixteen times. */
export function magicPacket(mac: string): Uint8Array {
  const bytes = mac.split(/[:-]/).map((part) => Number.parseInt(part, 16));
  if (bytes.length !== 6 || bytes.some((byte) => !Number.isInteger(byte))) {
    throw new Error(`Not a MAC address: ${mac}`);
  }
  const packet = new Uint8Array(102).fill(0xff);
  for (let repeat = 0; repeat < 16; repeat++) packet.set(bytes, 6 + repeat * 6);
  return packet;
}

/** A host this server can wake, learned while it was awake. */
export interface WakeEntry extends HostWakeInfo {
  readonly dnsName: string;
  readonly tailscaleIps: ReadonlyArray<string>;
  readonly learnedAt: number;
}

/** Finds a host by tailnet name, MagicDNS name, Tailscale IP, or LAN address. */
export function findWakeEntry(
  entries: ReadonlyArray<WakeEntry>,
  host: string,
): WakeEntry | undefined {
  const wanted = host
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[:/].*$/, "")
    .replace(/\.$/, "");
  if (!wanted) return undefined;
  return entries.find(
    (entry) =>
      entry.hostName.toLowerCase() === wanted ||
      entry.dnsName.toLowerCase() === wanted ||
      entry.dnsName.toLowerCase().startsWith(`${wanted}.`) ||
      entry.tailscaleIps.includes(wanted) ||
      entry.lanAddress === wanted,
  );
}

export interface TailscalePeer {
  readonly hostName: string;
  readonly dnsName: string;
  readonly tailscaleIps: ReadonlyArray<string>;
}

/** Online peers from `tailscale status --json`. */
export function onlineTailscalePeers(statusJson: unknown): ReadonlyArray<TailscalePeer> {
  const peers = (statusJson as { Peer?: Record<string, unknown> } | null)?.Peer ?? {};
  return Object.values(peers).flatMap((peer) => {
    const value = peer as {
      HostName?: unknown;
      DNSName?: unknown;
      TailscaleIPs?: unknown;
      Online?: unknown;
    };
    if (value.Online !== true || typeof value.DNSName !== "string" || !value.DNSName) return [];
    return [
      {
        hostName: typeof value.HostName === "string" ? value.HostName : "",
        dnsName: value.DNSName.replace(/\.$/, ""),
        tailscaleIps: Array.isArray(value.TailscaleIPs)
          ? value.TailscaleIPs.filter((ip): ip is string => typeof ip === "string")
          : [],
      },
    ];
  });
}
