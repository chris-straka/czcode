import {
  CZ_PROJECT_FILE_NAME,
  type EnvironmentId,
  type CzProjectFile,
  type CzProjectFileScript,
} from "@cz/contracts";
import { parseCzProjectFile } from "@cz/shared/czProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<CzProjectFileScript> = [];

export interface CzProjectFileState {
  /**
   * - `valid`: cz.json exists and decoded.
   * - `invalid`: cz.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable cz.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: CzProjectFile | null;
  scripts: ReadonlyArray<CzProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `cz.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useCzProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): CzProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", CZ_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseCzProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `cz.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useCzProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<CzProjectFileScript> {
  return useCzProjectFileState(environmentId, cwd).scripts;
}
