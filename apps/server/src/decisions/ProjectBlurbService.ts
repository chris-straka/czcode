/**
 * ProjectBlurbService - one line per decision project to jog the owner's
 * memory ("courtroom: trial adventure as a public defender"). Decision
 * projects are free names an agent picked, so the folder is found by name:
 * a cz project with that title, else `<root>/<name>` or `<root>/<any>/<name>`
 * under a cz project's root (`~/SWE/games/courtroom`). The owner's own line
 * wins over the folder README's opening.
 *
 * @module ProjectBlurbService
 */
import {
  type DecisionProjectBlurb,
  type DecisionProjectBlurbInput,
  DecisionStorageError,
} from "@cz/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ForkDatabase from "../forkDatabase/ForkDatabase.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class ProjectBlurbService extends Context.Service<
  ProjectBlurbService,
  {
    readonly blurbs: (
      projects: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<DecisionProjectBlurb>, DecisionStorageError>;
    readonly describe: (
      input: DecisionProjectBlurbInput,
    ) => Effect.Effect<DecisionProjectBlurb, DecisionStorageError>;
  }
>()("cz/decisions/ProjectBlurbService") {}

const MAX_CHARS = 160;
const README_NAMES = ["README.md", "readme.md", "README"];
/** README text changes rarely; re-read it at most this often. */
const README_TTL_MS = 5 * 60 * 1000;

/**
 * The first prose sentence of a README, plus the next one when the first is
 * short ("Investigation + trial adventure. You play a public defender…").
 */
export function readmeBlurb(markdown: string): string | null {
  const paragraph = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block.length > 0 && !/^(#|!\[|\[!\[|<|```|\||-{3,}|>)/.test(block) && /[a-z]/i.test(block),
    );
  if (!paragraph) return null;
  const text = paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  let line = sentences[0]!.trim();
  if (line.length < 60 && sentences[1]) line = `${line} ${sentences[1].trim()}`;
  return line.length <= MAX_CHARS ? line : `${line.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}

const make = Effect.gen(function* () {
  const { sql } = yield* ForkDatabase.ForkDatabase;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const readmeCache = new Map<string, { readonly at: number; readonly line: string | null }>();
  const storage = (operation: string) => (cause: unknown) =>
    new DecisionStorageError({ operation, cause });

  const isFolder = (dir: string) =>
    fs.stat(dir).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  /** Where a decision project lives, or null when no folder matches its name. */
  const folderFor = Effect.fn("ProjectBlurbService.folderFor")(function* (name: string) {
    if (!/^[\w.-]+$/.test(name)) return null;
    const live = (yield* projects.snapshot).projects.filter((p) => p.deletedAt === null);
    const titled = live.find((p) => p.title === name);
    if (titled) return titled.workspaceRoot;
    for (const root of new Set(live.map((p) => p.workspaceRoot))) {
      if (path.basename(root) === name) return root;
      const direct = path.join(root, name);
      if (yield* isFolder(direct)) return direct;
      const children = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
      for (const child of children) {
        if (child.startsWith(".")) continue;
        const nested = path.join(root, child, name);
        if (yield* isFolder(nested)) return nested;
      }
    }
    return null;
  });

  const readmeLine = Effect.fn("ProjectBlurbService.readmeLine")(function* (name: string) {
    const now = yield* Clock.currentTimeMillis;
    const cached = readmeCache.get(name);
    if (cached && now - cached.at < README_TTL_MS) return cached.line;
    const folder = yield* folderFor(name).pipe(Effect.orElseSucceed(() => null));
    let line: string | null = null;
    if (folder !== null) {
      for (const file of README_NAMES) {
        const text = yield* fs
          .readFileString(path.join(folder, file))
          .pipe(Effect.orElseSucceed(() => null));
        if (text !== null) {
          line = readmeBlurb(text);
          break;
        }
      }
    }
    readmeCache.set(name, { at: now, line });
    return line;
  });

  const ownerLines = sql<{ project: string; description: string }>`
    SELECT project, description FROM project_blurbs
  `.pipe(
    Effect.map((rows) => new Map(rows.map((row) => [row.project, row.description] as const))),
    Effect.mapError(storage("readProjectBlurbs")),
  );

  const blurbs: ProjectBlurbService["Service"]["blurbs"] = Effect.fn("ProjectBlurbService.blurbs")(
    function* (names) {
      const owned = yield* ownerLines;
      return yield* Effect.forEach(
        [...new Set(names)],
        (project) =>
          Effect.gen(function* () {
            const own = owned.get(project);
            if (own !== undefined) return { project, description: own, source: "owner" } as const;
            const line = yield* readmeLine(project);
            return line === null
              ? ({ project, description: null, source: null } as const)
              : ({ project, description: line, source: "readme" } as const);
          }),
        { concurrency: 4 },
      );
    },
  );

  const describe: ProjectBlurbService["Service"]["describe"] = Effect.fn(
    "ProjectBlurbService.describe",
  )(function* (input) {
    const text = input.description?.replace(/\s+/g, " ").trim() ?? "";
    if (text.length === 0) {
      yield* sql`DELETE FROM project_blurbs WHERE project = ${input.project}`.pipe(
        Effect.mapError(storage("clearProjectBlurb")),
      );
    } else {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        INSERT INTO project_blurbs ${sql.insert({ project: input.project, description: text, updated_at: now })}
        ON CONFLICT(project) DO UPDATE SET
          description = excluded.description, updated_at = excluded.updated_at
      `.pipe(Effect.mapError(storage("writeProjectBlurb")));
    }
    const [blurb] = yield* blurbs([input.project]);
    return blurb!;
  });

  return ProjectBlurbService.of({ blurbs, describe });
});

export const layer = Layer.effect(ProjectBlurbService, make);
