#!/usr/bin/env node
// Rewrites every T3 name in a git checkout to its cz name (map.ts).
//
//   node ccez/rename/rename.ts [--check] [repo-dir]
//
// Without --check it rewrites tracked files in place and `git mv`s renamed
// paths. With --check it changes nothing and exits 1 listing every file the
// codemod would still change, which is how ccez/rename/check proves no T3
// name is left. Deterministic: the same input tree always gives the same
// output tree.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { binaryRules, rules, skipFiles, skipPrefixes } from "./map.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();

const git = (...a: string[]) =>
  execFileSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });

// Long base64 runs (lockfile integrity hashes, inline images, fixtures) can
// contain "t3" by chance. Mask them so no rule touches them.
const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g;
function isBase64Noise(run: string): boolean {
  const digits = run.replace(/[^0-9]/g, "").length;
  const slashes = run.replace(/[^/]/g, "").length;
  return digits >= 4 && slashes <= run.length / 12;
}

export function renameText(text: string): string {
  const masked: string[] = [];
  let out = text.replace(BASE64_RUN, (run) => {
    if (!isBase64Noise(run)) return run;
    masked.push(run);
    return `\u0000${masked.length - 1}\u0000`;
  });
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => masked[Number(i)] as string);
}

const isSkipped = (path: string) =>
  skipFiles.includes(path) || skipPrefixes.some((prefix) => path.startsWith(prefix));

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function renameBinary(bytes: Buffer): Buffer {
  let out = bytes;
  for (const [from, to] of binaryRules) {
    const needle = Buffer.from(from, "latin1");
    if (!out.includes(needle)) continue;
    out = Buffer.from(out);
    for (let at = out.indexOf(needle); at !== -1; at = out.indexOf(needle, at + needle.length)) {
      out.write(to, at, "latin1");
    }
  }
  return out;
}

function main(): void {
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  const changed: string[] = [];
  const moves: [string, string][] = [];
  // pnpm-lock.yaml pins a sha256 of every patches/*.patch file.
  const patchHashes = new Map<string, string>();
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

  for (const path of files) {
    if (isSkipped(path)) continue;
    const target = renameText(path);
    if (target !== path) moves.push([path, target]);

    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      continue; // submodule or deleted in the working tree
    }
    if (isBinary(bytes)) {
      const next = renameBinary(bytes);
      if (next === bytes) continue;
      changed.push(path);
      if (!check) writeFileSync(join(root, path), next);
      continue;
    }
    const text = bytes.toString("utf8");
    const next = renameText(text);
    if (next === text) continue;
    changed.push(path);
    if (path.startsWith("patches/")) patchHashes.set(sha256(text), sha256(next));
    if (!check) writeFileSync(join(root, path), next);
  }

  if (!check && patchHashes.size > 0) {
    const lockPath = join(root, "pnpm-lock.yaml");
    let lock = readFileSync(lockPath, "utf8");
    for (const [from, to] of patchHashes) lock = lock.replaceAll(from, to);
    writeFileSync(lockPath, lock);
  }

  if (check) {
    const offenders = [...new Set([...changed, ...moves.map(([from]) => from)])].sort();
    if (offenders.length === 0) {
      console.log("rename check: no T3 names outside the allowlist");
      return;
    }
    console.error(`rename check: ${offenders.length} files still carry T3 names:`);
    for (const path of offenders) console.error(`  ${path}`);
    process.exitCode = 1;
    return;
  }

  for (const [from, to] of moves) {
    const dir = to.slice(0, to.lastIndexOf("/"));
    if (dir) execFileSync("mkdir", ["-p", join(root, dir)]);
    git("mv", "-k", from, to);
  }
  // Renamed workspace packages sort differently; let pnpm re-serialize the
  // lockfile (no resolution changes) so a later `pnpm install` leaves it be.
  const pnpm = (...extra: string[]) =>
    execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts", ...extra], {
      cwd: root,
      stdio: "ignore",
    });
  try {
    pnpm("--offline");
  } catch {
    pnpm();
  }
  // Renamed identifiers change line lengths; reflow with the repo's own
  // formatter so the output matches what upstream's tooling would write.
  execFileSync("vp", ["fmt"], { cwd: root, stdio: "ignore" });
  console.log(`rename: rewrote ${changed.length} files, moved ${moves.length} paths`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
