/**
 * ThreadDigestService - what a feed card shows for a thread beyond its shell:
 * the latest result, and the folder the thread worked in. Threads queued
 * against a workspace like ~/SWE all share one project, so the folder comes
 * from what the thread actually touched: files it changed and folders it
 * `cd`'d into, each resolved to the nearest git repo below the project root.
 *
 * @module ThreadDigestService
 */
import { type ThreadDigest, ThreadId } from "@cz/contracts";
import { HostProcessEnvironment } from "@cz/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class ThreadDigestService extends Context.Service<
  ThreadDigestService,
  {
    readonly digests: (
      threadIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<ThreadDigest>>;
  }
>()("cz/threadControl/ThreadDigestService") {}

const EXCERPT_CHARS = 320;
/** How far back a thread's touched paths count toward its folder. */
const RECENT_PATH_ITEMS = 60;

/** Plain text from the start of a markdown message: no images, links keep their text. */
export function excerptOf(markdown: string): string | null {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/[`*_>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  return text.length <= EXCERPT_CHARS ? text : `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

/** Absolute folders a shell command `cd`s into, with `~` expanded. */
export function cdTargets(command: string, home: string): ReadonlyArray<string> {
  const targets: string[] = [];
  for (const match of command.matchAll(
    /(?:^|[;&|(]|\s)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,
  )) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const expanded = raw === "~" ? home : raw.startsWith("~/") ? `${home}${raw.slice(1)}` : raw;
    if (expanded.startsWith("/")) targets.push(expanded.replace(/\/+$/, "") || "/");
  }
  return targets;
}

/** The most common value; ties go to the earliest (most recent) one. */
function mostCommon(values: ReadonlyArray<string>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const environment = yield* HostProcessEnvironment;
  const home = environment.HOME ?? environment.USERPROFILE ?? "";
  // Folder -> its repo folder. Repos don't move while the server runs.
  const repoCache = new Map<string, string>();

  /** The nearest folder at or above `dir`, below `root`, that is a git repo; else `dir` capped at two levels. */
  const repoFolder = Effect.fn("ThreadDigestService.repoFolder")(function* (
    root: string,
    dir: string,
  ) {
    const key = `${root}\u0000${dir}`;
    const cached = repoCache.get(key);
    if (cached !== undefined) return cached;
    let found: string | null = null;
    for (let current = dir; current !== root && current.startsWith(`${root}/`);) {
      if (yield* fs.exists(path.join(current, ".git")).pipe(Effect.orElseSucceed(() => false))) {
        found = current;
        break;
      }
      current = path.dirname(current);
    }
    const relative = path.relative(root, dir).split(path.sep).slice(0, 2).join("/");
    const result = found ?? (relative ? path.join(root, relative) : root);
    if (repoCache.size > 5_000) repoCache.clear();
    repoCache.set(key, result);
    return result;
  });

  const workingSubpath = Effect.fn("ThreadDigestService.workingSubpath")(function* (
    threadId: string,
    root: string,
  ) {
    const rows = yield* sql<{ type: string; file: string | null; input: string | null }>`
      SELECT type,
        json_extract(payload_json, '$.fileName') AS file,
        json_extract(payload_json, '$.input') AS input
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${threadId} AND type IN ('file_change', 'command_execution')
      ORDER BY ordinal DESC
      LIMIT ${RECENT_PATH_ITEMS}
    `;
    const dirs = rows.flatMap((row) =>
      row.type === "file_change"
        ? row.file?.startsWith("/")
          ? [path.dirname(row.file)]
          : []
        : cdTargets(row.input ?? "", home),
    );
    const folders = yield* Effect.forEach(
      dirs.filter((dir) => dir.startsWith(`${root}/`)),
      (dir) => repoFolder(root, dir),
    );
    const folder = mostCommon(folders);
    return folder === null || folder === root ? null : path.relative(root, folder);
  });

  const excerpt = Effect.fn("ThreadDigestService.excerpt")(function* (threadId: string) {
    const rows = yield* sql<{ text: string | null }>`
      SELECT json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${threadId} AND type = 'assistant_message'
        AND status = 'completed' AND parent_item_id IS NULL
      ORDER BY ordinal DESC
      LIMIT 1
    `;
    return excerptOf(rows[0]?.text ?? "");
  });

  const digests: ThreadDigestService["Service"]["digests"] = (threadIds) =>
    Effect.gen(function* () {
      const roots = new Map(
        (yield* projects.snapshot).projects.map(
          (project) => [project.id as string, project.workspaceRoot] as const,
        ),
      );
      return yield* Effect.forEach(
        threadIds,
        (threadId) =>
          Effect.gen(function* () {
            const shell = yield* projections.getThreadShell(ThreadId.make(threadId));
            const root = shell === null ? undefined : roots.get(shell.projectId);
            return {
              threadId,
              excerpt: yield* excerpt(threadId),
              workingSubpath:
                root === undefined || shell?.worktreePath
                  ? null
                  : yield* workingSubpath(threadId, root),
            } satisfies ThreadDigest;
          }).pipe(
            Effect.orElseSucceed((): ThreadDigest => ({
              threadId,
              excerpt: null,
              workingSubpath: null,
            })),
          ),
        { concurrency: 4 },
      );
    }).pipe(Effect.orElseSucceed((): ReadonlyArray<ThreadDigest> => []));

  return ThreadDigestService.of({ digests });
});

export const layer = Layer.effect(ThreadDigestService, make);
