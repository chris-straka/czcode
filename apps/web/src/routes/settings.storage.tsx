import { createFileRoute, redirect } from "@tanstack/react-router";

// Storage's worktree rows live in Source Control now; keep old links working.
export const Route = createFileRoute("/settings/storage")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/source-control", search, replace: true });
  },
});
