// @effect-diagnostics nodeBuiltinImport:off -- Runs synchronously at process start, before any Effect runtime exists (desktop pre-ready, server base dir), like DesktopPreReadyFileSystem.
/**
 * Pre-rename names. czcode is T3 Code renamed by a codemod (ccez/rename), so
 * a machine that ran T3 Code keeps its env vars, its data, and its projects'
 * `t3.json` files. Each old name is read here and moved to its cz name; this
 * is the only source file that spells them.
 *
 * Node-only: the server and the desktop main process call it at startup.
 *
 * @module legacyNames
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

/** Project file name before the rename; read when `cz.json` is absent. */
export const LEGACY_PROJECT_FILE_NAME = "t3.json";

const LEGACY_ENV_PREFIX = "T3CODE_";
const ENV_PREFIX = "CZ_";

/**
 * Copies each `T3CODE_*` variable to its `CZ_*` name unless that is already
 * set, and returns the old names it used so the caller can warn once.
 */
export function adoptLegacyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const adopted: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue;
    const next = ENV_PREFIX + key.slice(LEGACY_ENV_PREFIX.length);
    if (env[next] !== undefined) continue;
    env[next] = value;
    adopted.push(key);
  }
  return adopted;
}

export const LEGACY_HOME_MIGRATED_MESSAGE = "Copied ~/.t3 to ~/.cz (first run after the rename).";

export function legacyEnvWarning(adopted: readonly string[]): string {
  return `Read ${adopted.join(", ")}; rename ${adopted.length === 1 ? "it" : "them"} to CZ_* (old names stop working in a later release).`;
}

// Rebuilt on demand, or tied to the old location: runtime/ (bundled
// runtimes, sockets), caches/, tools/, scratch/, logs, and worktrees/ (git
// worktrees cannot move, and threads point at them where they are). Connect
// tokens went away with Connect.
const NOT_MIGRATED = new Set([
  "runtime",
  "caches",
  "tools",
  "scratch",
  "worktrees",
  "userdata/logs",
  "userdata/clerk-tokens.json",
]);

/**
 * First run after the rename: copies `~/.t3` to `~/.cz` when `~/.cz` does not
 * exist yet. `~/.t3` is only read, so a T3 Code install still using it keeps
 * working. SQLite databases are snapshotted with `VACUUM INTO`, which is
 * consistent even while another process has them open. The copy is staged
 * and renamed into place, so a crash or a concurrent first run never leaves a
 * half-copied `~/.cz`.
 */
export function migrateLegacyHome(homeDir: string = NodeOS.homedir()): "migrated" | "none" {
  const target = NodePath.join(homeDir, ".cz");
  const source = NodePath.join(homeDir, ".t3");
  if (NodeFS.existsSync(target) || !NodeFS.existsSync(source)) return "none";
  const staging = `${target}.migrating-${process.pid}`;
  NodeFS.rmSync(staging, { recursive: true, force: true });
  try {
    copyTree(source, staging, "");
    NodeFS.renameSync(staging, target);
  } catch (error) {
    NodeFS.rmSync(staging, { recursive: true, force: true });
    if (NodeFS.existsSync(target)) return "none"; // another process migrated first
    throw error;
  }
  return "migrated";
}

function copyTree(from: string, to: string, relative: string): void {
  NodeFS.mkdirSync(to, { recursive: true, mode: NodeFS.statSync(from).mode });
  for (const entry of NodeFS.readdirSync(from, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (NOT_MIGRATED.has(rel)) continue;
    const src = NodePath.join(from, entry.name);
    const dst = NodePath.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, rel);
    } else if (entry.isSymbolicLink()) {
      NodeFS.symlinkSync(NodeFS.readlinkSync(src), dst);
    } else if (/\.sqlite-(?:wal|shm|journal)$/.test(entry.name)) {
      continue; // folded into the snapshot below
    } else if (entry.name.endsWith(".sqlite")) {
      snapshotSqlite(src, dst);
    } else if (entry.isFile()) {
      NodeFS.copyFileSync(src, dst);
      NodeFS.chmodSync(dst, NodeFS.statSync(src).mode);
    }
  }
}

function snapshotSqlite(source: string, target: string): void {
  const db = new NodeSqlite.DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}
