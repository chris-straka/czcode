import { describe, expect, it } from "vite-plus/test";

import {
  parseDarwinSwapUsage,
  parseLinuxDiskMounts,
  parseProcSwaps,
  parseZramMemoryBytes,
  swapFromDevices,
} from "./hostCapacity.ts";

// Read on f-ms-7917 (Ubuntu 26.04): a swap file plus zram.
const PROC_SWAPS = `Filename				Type		Size		Used		Priority
/swap.img                               file		16777212	0		-1
/dev/zram0                              partition	15881212	664988		100
`;

describe("host capacity", () => {
  it("reads swap devices from /proc/swaps, telling zram apart", () => {
    const devices = parseProcSwaps(PROC_SWAPS);
    expect(devices).toEqual([
      { name: "/swap.img", kind: "file", sizeBytes: 16777212 * 1024, usedBytes: 0 },
      { name: "/dev/zram0", kind: "zram", sizeBytes: 15881212 * 1024, usedBytes: 664988 * 1024 },
    ]);
    expect(swapFromDevices(devices).usedBytes).toBe(664988 * 1024);
  });

  it("reads the RAM zram uses from mm_stat", () => {
    expect(
      parseZramMemoryBytes("666247168 325283624 330661888        0 330809344      241        0"),
    ).toBe(330661888);
    expect(parseZramMemoryBytes("")).toBe(null);
  });

  it("reads macOS swap usage", () => {
    expect(
      parseDarwinSwapUsage(
        "vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)",
      ),
    ).toEqual({
      totalBytes: 2048 * 1024 * 1024,
      usedBytes: Math.round(1024.5 * 1024 * 1024),
      devices: [],
    });
  });

  it("lists one mount per real disk", () => {
    const mounts = [
      "/dev/sda2 / ext4 rw,relatime 0 0",
      "/dev/sdb1 /home ext4 rw,noatime 0 0",
      "/dev/nvme0n1p2 /mnt/My\\040Games btrfs rw 0 0",
      "/dev/nvme0n1p2 /mnt/My\\040Games/@snapshots btrfs rw 0 0",
      "/dev/loop3 /snap/core22/1380 squashfs ro 0 0",
      "tmpfs /run tmpfs rw 0 0",
      "/dev/loop9 /mnt/image ext4 rw 0 0",
    ].join("\n");
    expect(parseLinuxDiskMounts(mounts)).toEqual(["/", "/home", "/mnt/My Games"]);
  });
});
