import type * as NodeOS from "node:os";
import { describe, expect, it } from "vite-plus/test";

import {
  broadcastAddress,
  findWakeEntry,
  magicPacket,
  onlineTailscalePeers,
  wakeInterface,
} from "./wake.ts";

const ipv4 = (
  address: string,
  mac: string,
  netmask = "255.255.255.0",
): NodeOS.NetworkInterfaceInfo => ({
  address,
  netmask,
  family: "IPv4",
  mac,
  internal: false,
  cidr: null,
});

describe("host wake", () => {
  it("builds the magic packet: six 0xff bytes, then the MAC sixteen times", () => {
    const packet = magicPacket("fc:aa:14:82:19:91");
    expect(packet.length).toBe(102);
    expect([...packet.slice(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...packet.slice(96)]).toEqual([0xfc, 0xaa, 0x14, 0x82, 0x19, 0x91]);
    expect(() => magicPacket("not-a-mac")).toThrow();
  });

  it("picks the wired LAN interface and its broadcast address", () => {
    expect(broadcastAddress("192.168.0.211", "255.255.255.0")).toBe("192.168.0.255");
    expect(
      wakeInterface({
        lo: [{ ...ipv4("127.0.0.1", "00:00:00:00:00:00"), internal: true }],
        tailscale0: [ipv4("100.73.224.49", "00:00:00:00:00:00")],
        wlp2s0: [ipv4("192.168.0.50", "aa:aa:aa:aa:aa:aa")],
        enp3s0: [ipv4("192.168.0.211", "fc:aa:14:82:19:91")],
      }),
    ).toEqual({
      mac: "fc:aa:14:82:19:91",
      lanAddress: "192.168.0.211",
      broadcast: "192.168.0.255",
    });
    expect(wakeInterface({ tailscale0: [ipv4("100.73.224.49", "00:00:00:00:00:00")] })).toBeNull();
  });

  it("finds a host by any name a client might know it by", () => {
    const entries = [
      {
        hostName: "basement",
        dnsName: "basement.tailfe37c2.ts.net",
        tailscaleIps: ["100.73.224.49"],
        mac: "fc:aa:14:82:19:91",
        lanAddress: "192.168.0.211",
        broadcast: "192.168.0.255",
        learnedAt: 0,
      },
    ];
    for (const host of [
      "basement",
      "https://basement.tailfe37c2.ts.net/",
      "100.73.224.49",
      "http://192.168.0.211:3773",
    ]) {
      expect(findWakeEntry(entries, host)?.hostName).toBe("basement");
    }
    expect(findWakeEntry(entries, "z")).toBeUndefined();
  });

  it("reads online peers from tailscale status", () => {
    expect(
      onlineTailscalePeers({
        Peer: {
          a: {
            HostName: "basement",
            DNSName: "basement.tailfe37c2.ts.net.",
            TailscaleIPs: ["100.73.224.49"],
            Online: true,
          },
          b: { HostName: "old", DNSName: "old.tailfe37c2.ts.net.", Online: false },
        },
      }),
    ).toEqual([
      {
        hostName: "basement",
        dnsName: "basement.tailfe37c2.ts.net",
        tailscaleIps: ["100.73.224.49"],
      },
    ]);
  });
});
