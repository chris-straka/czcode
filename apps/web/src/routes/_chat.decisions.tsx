import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/decisions")({
  // `open` (environmentId:decisionId) opens one decision, e.g. from its thread's banner.
  validateSearch: (search: Record<string, unknown>): { open?: string } =>
    typeof search.open === "string" ? { open: search.open } : {},
  // The feed under every route answers this one; it opens the decision in a modal.
  component: () => null,
});
