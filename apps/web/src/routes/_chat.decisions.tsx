import { createFileRoute } from "@tanstack/react-router";

import { DecisionsPage } from "../components/decisions/DecisionsPage";

export const Route = createFileRoute("/_chat/decisions")({
  // `open` (environmentId:decisionId) opens one decision, e.g. from its thread's banner.
  validateSearch: (search: Record<string, unknown>): { open?: string } =>
    typeof search.open === "string" ? { open: search.open } : {},
  component: DecisionsPage,
});
