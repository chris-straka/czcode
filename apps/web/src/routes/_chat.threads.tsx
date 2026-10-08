import { createFileRoute } from "@tanstack/react-router";

// The Threads page of the feed; the feed under every route draws it.
export const Route = createFileRoute("/_chat/threads")({
  // `project` opens one project's threads from its card.
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    ...(typeof search.project === "string" ? { project: search.project } : {}),
  }),
  component: () => null,
});
