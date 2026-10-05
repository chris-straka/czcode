/**
 * The project `cz tui` was opened in: projects whose workspace contains the
 * cwd, widened to the same repository (git origin) on every host, so a
 * project's threads on the Windows and Linux boxes show too.
 *
 * @module scope
 */
import type { EnvironmentId, ProjectId } from "@cz/contracts";

import type { EnvironmentShell } from "./threadList.ts";

export interface ProjectScope {
  /** `environmentId:projectId` for every project in scope. */
  readonly keys: ReadonlySet<string>;
  /** The title to show for the scope (the cwd's project). */
  readonly title: string;
  /** Folder names in scope, for matching decisions by their project name. */
  readonly names: ReadonlySet<string>;
}

export const projectKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
  `${environmentId}:${projectId}`;

const trimSlash = (path: string) => path.replace(/\/+$/, "");
const folder = (path: string) => trimSlash(path).split("/").pop()?.toLowerCase() ?? "";

/** The scope for `cwd`, or null when no project contains it (show everything). */
export function projectScope(
  shells: ReadonlyArray<EnvironmentShell>,
  cwd: string,
): ProjectScope | null {
  const here = trimSlash(cwd);
  const projects = shells.flatMap((shell) =>
    (shell.snapshot?.projects ?? []).map((project) => ({
      environmentId: shell.environmentId,
      project,
    })),
  );
  // Deepest root wins when workspaces nest.
  const containing = projects
    .filter(({ project }) => {
      const root = trimSlash(project.workspaceRoot);
      return here === root || here.startsWith(`${root}/`);
    })
    .toSorted(
      (left, right) => right.project.workspaceRoot.length - left.project.workspaceRoot.length,
    );
  const match = containing[0];
  if (!match) return null;
  const identity = match.project.repositoryIdentity?.canonicalKey ?? null;
  const inScope = projects.filter(
    ({ project }) =>
      trimSlash(project.workspaceRoot) === trimSlash(match.project.workspaceRoot) ||
      (identity !== null && project.repositoryIdentity?.canonicalKey === identity),
  );
  return {
    keys: new Set(
      inScope.map(({ environmentId, project }) => projectKey(environmentId, project.id)),
    ),
    title: match.project.title,
    names: new Set(
      inScope.flatMap(({ project }) => [
        project.title.toLowerCase(),
        folder(project.workspaceRoot),
      ]),
    ),
  };
}
