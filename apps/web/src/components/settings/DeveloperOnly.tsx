import type { ReactNode } from "react";

import { useClientSettings } from "../../hooks/useSettings";

const selectDeveloperControls = (settings: { developerControlsEnabled: boolean }) =>
  settings.developerControlsEnabled;

/** Whether Settings shows its technical rows (git, merge, worktree, diff and background tuning). */
export function useDeveloperControls(): boolean {
  return useClientSettings(selectDeveloperControls);
}

/** Renders technical settings only while Developer controls is on (Settings > General). */
export function DeveloperOnly({ children }: { children: ReactNode }) {
  return useDeveloperControls() ? children : null;
}
