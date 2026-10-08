/**
 * Swap, zram, and disk readings for HostResources, parsed from what each OS
 * prints. Pure, so the formats are testable without the machine.
 *
 * @module hostCapacity
 */
import type { HostResourcesSnapshot } from "@cz/contracts";

type Swap = NonNullable<HostResourcesSnapshot["swap"]>;
type SwapDevice = Swap["devices"][number];

/** /proc/swaps (sizes in KiB): every swap device, zram included. */
export function parseProcSwaps(text: string): Array<SwapDevice> {
  return text
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const [name, type, size, used] = line.trim().split(/\s+/);
      if (!name || !size || !used) return [];
      const kind = name.includes("/zram") ? "zram" : type === "file" ? "file" : "partition";
      return [{ name, kind, sizeBytes: Number(size) * 1024, usedBytes: Number(used) * 1024 }];
    });
}

/** /sys/block/zramN/mm_stat: the third field is the RAM zram itself uses. */
export function parseZramMemoryBytes(mmStat: string): number | null {
  const value = Number(mmStat.trim().split(/\s+/)[2]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** macOS `sysctl vm.swapusage`: "total = 2048.00M  used = 1052.25M  free = 995.75M". */
export function parseDarwinSwapUsage(text: string): Swap | null {
  const megabytes = (key: string) => {
    const value = new RegExp(`${key} = ([\\d.]+)M`).exec(text)?.[1];
    return value === undefined ? null : Math.round(Number(value) * 1024 * 1024);
  };
  const total = megabytes("total");
  const used = megabytes("used");
  return total === null || used === null
    ? null
    : { totalBytes: total, usedBytes: used, devices: [] };
}

/** macOS `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function parseDarwinMemoryPressure(text: string): "normal" | "warn" | "critical" | null {
  const level = Number(text.trim());
  return level === 1 ? "normal" : level === 2 ? "warn" : level === 4 ? "critical" : null;
}

const DISK_FILESYSTEMS = new Set([
  "ext2",
  "ext3",
  "ext4",
  "xfs",
  "btrfs",
  "f2fs",
  "zfs",
  "bcachefs",
  "vfat",
  "exfat",
  "ntfs",
  "ntfs3",
  "fuseblk",
]);

/**
 * The mount points of real disks in /proc/self/mounts, one per device (btrfs
 * subvolumes share one), skipping snap and loop images and the boot and EFI
 * partitions, which hold no work.
 */
export function parseLinuxDiskMounts(mounts: string): Array<string> {
  const byDevice = new Map<string, string>();
  for (const line of mounts.split("\n")) {
    const [device, rawMount, type] = line.split(" ");
    if (!device || !rawMount || !type || !DISK_FILESYSTEMS.has(type)) continue;
    if (device.startsWith("/dev/loop")) continue;
    // Spaces in mount points are octal-escaped.
    const mount = rawMount.replace(/\\040/g, " ");
    if (mount.startsWith("/snap/") || mount === "/boot" || mount.startsWith("/boot/")) continue;
    const existing = byDevice.get(device);
    if (existing === undefined || mount.length < existing.length) byDevice.set(device, mount);
  }
  return [...byDevice.values()].toSorted();
}

/**
 * One entry per disk: volumes that report the same size and free space share
 * one store, such as every APFS volume in a Mac's container ("Macintosh HD"
 * under /Volumes is the system disk again). The first mount listed is kept.
 */
export function sameDiskOnce<
  Disk extends { readonly totalBytes: number; readonly freeBytes: number },
>(disks: ReadonlyArray<Disk>): Array<Disk> {
  const seen = new Set<string>();
  return disks.filter((disk) => {
    const key = `${disk.totalBytes}:${disk.freeBytes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Totals over the devices, as the snapshot carries them. */
export function swapFromDevices(devices: ReadonlyArray<SwapDevice>): Swap {
  return {
    totalBytes: devices.reduce((sum, device) => sum + device.sizeBytes, 0),
    usedBytes: devices.reduce((sum, device) => sum + device.usedBytes, 0),
    devices: [...devices],
  };
}
