import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@cz/contracts";

import { projectScope } from "./scope.ts";
import type { EnvironmentShell } from "./threadList.ts";

const project = (id: string, workspaceRoot: string, origin: string | null) => ({
  id,
  title: workspaceRoot.split("/").pop() ?? id,
  workspaceRoot,
  repositoryIdentity: origin === null ? null : { canonicalKey: origin },
});

const shell = (environmentId: string, projects: ReadonlyArray<ReturnType<typeof project>>) =>
  ({
    environmentId: environmentId as EnvironmentId,
    label: environmentId,
    snapshot: {
      projects,
      threads: [],
      archivedThreads: [],
    } as unknown as OrchestrationV2ShellSnapshot,
  }) satisfies EnvironmentShell;

const shells = [
  shell("mac", [
    project("p1", "/Users/c/SWE/launchkit", "github.com/c/launchkit"),
    project("p2", "/Users/c/SWE/games/hll", "github.com/c/hll"),
    project("p3", "/Users/c/SWE/games", null),
  ]),
  shell("wsl", [
    project("w1", "/home/c/launchkit", "github.com/c/launchkit"),
    project("w2", "/home/c/other", "github.com/c/other"),
  ]),
];

describe("projectScope", () => {
  it("scopes to the cwd's project and the same repository on other hosts", () => {
    const scope = projectScope(shells, "/Users/c/SWE/launchkit/src");
    expect(scope?.title).toBe("launchkit");
    expect([...(scope?.keys ?? [])].sort()).toEqual(["mac:p1", "wsl:w1"]);
  });

  it("prefers the deepest workspace when roots nest", () => {
    expect([...(projectScope(shells, "/Users/c/SWE/games/hll")?.keys ?? [])]).toEqual(["mac:p2"]);
  });

  it("matches the root itself but not a sibling with the same prefix", () => {
    expect(projectScope(shells, "/Users/c/SWE/launchkit")?.title).toBe("launchkit");
    expect(projectScope(shells, "/Users/c/SWE/launchkit-old")).toBeNull();
  });

  it("is null outside every project, so everything shows", () => {
    expect(projectScope(shells, "/tmp")).toBeNull();
  });
});
