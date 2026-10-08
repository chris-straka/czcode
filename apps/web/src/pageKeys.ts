/**
 * Keys that belong to one page rather than the app-wide keybindings file.
 * Settings > Keybindings lists them under "Page keys"; the UI shows no hints.
 */
export const PAGE_KEY_GROUPS: readonly {
  page: string;
  keys: readonly { keys: readonly string[]; action: string }[];
}[] = [
  {
    // useSlashOpensSearch (AppSidebarLayout) and FeedModal's Esc.
    page: "Anywhere",
    keys: [
      { keys: ["/"], action: "Search threads, projects and commands" },
      { keys: ["Esc"], action: "Close the top view, menu or field, one at a time" },
    ],
  },
  {
    // useVimKeys in FeedPage, the same motions as ccez-llm.
    page: "Lists: Needs you, Threads, Decisions",
    keys: [
      { keys: ["j", "k"], action: "Next or previous item" },
      { keys: ["d", "u"], action: "Three items down or up" },
      { keys: ["Ctrl+D", "Ctrl+U"], action: "Half a screen down or up" },
      { keys: ["g g", "G"], action: "First or last item" },
      { keys: ["l", "Enter"], action: "Open the focused item" },
    ],
  },
  {
    // useVimKeys and the Space handler in FeedModal.
    page: "An open thread, Decision or Settings",
    keys: [
      { keys: ["j", "k"], action: "Scroll a line" },
      { keys: ["d", "u"], action: "Scroll three lines" },
      { keys: ["Ctrl+D", "Ctrl+U"], action: "Scroll half a screen" },
      { keys: ["g g", "G"], action: "Top or bottom" },
      { keys: ["h", "Esc"], action: "Back to the list" },
      { keys: ["Space"], action: "Play or pause the clip or sound" },
    ],
  },
  {
    // DecisionView's own keys.
    page: "Decision",
    keys: [
      { keys: ["1–9"], action: "Pick that option or verdict" },
      { keys: ["0"], action: "None of these" },
      { keys: ["r"], action: "None of these, try again" },
      { keys: ["Enter"], action: "Send the answer" },
      { keys: ["n", "p"], action: "Next or previous Decision" },
    ],
  },
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
