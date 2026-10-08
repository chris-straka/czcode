import { createFileRoute } from "@tanstack/react-router";

// The Threads page of the feed; the feed under every route draws it.
export const Route = createFileRoute("/_chat/threads")({
  component: () => null,
});
