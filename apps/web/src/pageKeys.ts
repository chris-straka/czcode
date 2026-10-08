/**
 * Keys that belong to one page rather than the app-wide keybindings file.
 * Settings > Keybindings lists them under "Page keys"; the UI shows no hints.
 */
export const PAGE_KEY_GROUPS: readonly {
  page: string;
  keys: readonly { keys: readonly string[]; action: string }[];
}[] = [
  {
    // threadHoverKeys.ts: over a hovered (or focused) thread row or project card.
    page: "Threads page",
    keys: [
      { keys: ["Enter", "o"], action: "Open the hovered thread or project" },
      { keys: ["e"], action: "Archive the hovered thread; on a project, its finished threads" },
      {
        keys: ["Shift+D"],
        action: "Delete the hovered thread, with undo; on a project, its failed threads",
      },
      { keys: ["s"], action: "Stop the hovered running thread; on a project, all of its runs" },
    ],
  },
];
