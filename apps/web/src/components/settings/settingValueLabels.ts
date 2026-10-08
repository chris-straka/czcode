import type { RuntimeMode, ServerSettings, WorktreeSubmodules } from "@cz/contracts";

import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";

const WRITING_STYLE_LABELS: Record<string, string> = {
  repo_conventions: "Repository conventions",
  conventional_commits: "Conventional Commits",
  custom: "Custom instructions",
};

/** Human labels for the values the chain can show; falls back to a type summary. */
export function formatValue(key: keyof ServerSettings, value: unknown): string {
  if (value === null || value === undefined) {
    return key === "pullRequestMergeMethod"
      ? "Last selected"
      : key === "sidebarAutoSettleAfterDays"
        ? "Never"
        : key === "defaultModelSelection"
          ? "Automatic"
          : key === "sourceControlWriterModelSelection"
            ? "Text generation model"
            : key === "defaultThreadEnvMode" || key === "worktreeSubmodules"
              ? "Inherit"
              : "Not set";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    return key === "sidebarAutoSettleAfterDays"
      ? `${value} ${value === 1 ? "day" : "days"}`
      : String(value);
  }
  if (typeof value === "string") {
    if (key === "defaultRuntimeMode" && value in runtimeModeConfig) {
      return runtimeModeConfig[value as RuntimeMode].label;
    }
    if (key === "defaultThreadEnvMode" && (value === "local" || value === "worktree")) {
      return resolveEnvModeLabel(value);
    }
    if (key === "worktreeSubmodules" && value in WORKTREE_SUBMODULES_LABELS) {
      return WORKTREE_SUBMODULES_LABELS[value as WorktreeSubmodules];
    }
    if (key === "pullRequestMergeMethod" && value in PULL_REQUEST_MERGE_METHOD_LABELS) {
      return PULL_REQUEST_MERGE_METHOD_LABELS[
        value as keyof typeof PULL_REQUEST_MERGE_METHOD_LABELS
      ];
    }
    return value === "" ? "Empty" : value;
  }
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    if ("model" in value && typeof value.model === "string") return value.model;
    if ("mode" in value && typeof value.mode === "string") {
      return WRITING_STYLE_LABELS[value.mode] ?? value.mode;
    }
  }
  return "Custom";
}
