import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@cz/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findMachine, mergeMachines } from "./machines.ts";

const descriptor = (id: string, label: string) =>
  ({
    environmentId: EnvironmentId.make(id),
    label,
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.46",
    capabilities: {},
  }) as unknown as ExecutionEnvironmentDescriptor;

describe("mergeMachines", () => {
  const merged = mergeMachines({
    self: descriptor("art", "art-MS-7917"),
    selfUrl: "https://art-ms-7917.tail.ts.net",
    saved: [
      {
        environmentId: "z",
        label: "z",
        httpBaseUrl: "https://z.tail.ts.net",
        bearerToken: "t",
      },
      {
        environmentId: "laptop",
        label: "laptop",
        httpBaseUrl: "http://192.168.0.9:3773",
        bearerToken: "t",
      },
    ],
    found: [
      { httpBaseUrl: "https://z.tail.ts.net", descriptor: descriptor("z", "z") },
      {
        httpBaseUrl: "https://basement.tail.ts.net",
        descriptor: descriptor("basement", "basement"),
      },
    ],
  });

  it("lists this machine, then signed-in machines, then ones only found, once each", () => {
    expect(merged.map((machine) => [machine.label, machine.signedIn, machine.online])).toEqual([
      ["art-MS-7917", true, true],
      ["laptop", true, false],
      ["z", true, true],
      ["basement", false, true],
    ]);
    expect(merged[0]).toMatchObject({ self: true, httpBaseUrl: "https://art-ms-7917.tail.ts.net" });
  });

  it("finds a machine by label, id, or tailnet name", () => {
    expect(findMachine(merged, "BASEMENT")?.environmentId).toBe("basement");
    expect(findMachine(merged, "z")?.environmentId).toBe("z");
    expect(findMachine(merged, "art-ms-7917.tail.ts.net")?.self).toBe(true);
    expect(findMachine(merged, "nowhere")).toBeUndefined();
  });
});
