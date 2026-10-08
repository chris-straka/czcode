import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/decisions")({
  // `open` (environmentId:decisionId) opens one decision, e.g. from its thread's banner.
  // `session=1` steps through every open Decision (Review all).
  validateSearch: (search: Record<string, unknown>): { open?: string; session?: "1" } => ({
    ...(typeof search.open === "string" ? { open: search.open } : {}),
    ...(search.session === "1" ? { session: "1" as const } : {}),
  }),
  // The feed under every route answers this one; it opens the Decision as a full view.
  component: () => null,
});
