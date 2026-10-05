import { describe, expect, it } from "vite-plus/test";

import { CZ_MCP_TOOL_NAMES, resolveCzMcpToolPresentation } from "./czMcpToolPresentation.ts";

describe("resolveCzMcpToolPresentation", () => {
  it("recognizes every cz tool across provider prefixes and completion suffixes", () => {
    for (const tool of CZ_MCP_TOOL_NAMES) {
      const presentation = resolveCzMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__czcode__",
        "mcp__czcode__",
        "mcp__czcode__",
        "czcode.",
        "czcode/",
        "czcode:",
        "mcp_czcode_",
        "czcode ",
        "czcode · ",
      ]) {
        expect(resolveCzMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveCzMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor cz MCP tool names", () => {
    expect(resolveCzMcpToolPresentation("mcp__czcode__cz_thread_read")).toEqual({
      displayName: "Read a cz thread",
      logo: "czcode",
    });
  });

  it("pretty prints Codex cz MCP tool names", () => {
    expect(resolveCzMcpToolPresentation("czcode.create_threads")).toEqual({
      displayName: "Create cz threads",
      logo: "czcode",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveCzMcpToolPresentation("mcp__czcode__cz_thread_update")).toEqual({
      displayName: "Update cz thread metadata",
      logo: "czcode",
    });
  });

  it("pretty prints bare cz MCP toolkit names", () => {
    expect(resolveCzMcpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "czcode",
    });
  });

  it("pretty prints worktree cz MCP tool names", () => {
    expect(resolveCzMcpToolPresentation("mcp__czcode__cz_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "czcode",
    });
    expect(resolveCzMcpToolPresentation("czcode.cz_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "czcode",
    });
  });

  it("pretty prints preview cz MCP tool names", () => {
    expect(resolveCzMcpToolPresentation("czcode.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "czcode",
    });
    expect(resolveCzMcpToolPresentation("mcp__czcode__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "czcode",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_czcode_delegate_task",
      "czcode:delegate_task",
      "czcode/delegate_task",
      "czcode delegate_task",
      "czcode delegate_task",
      "czcode__delegate_task",
    ]) {
      expect(resolveCzMcpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveCzMcpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveCzMcpToolPresentation("czcode.not_a_real_tool")).toBeNull();
  });
});
