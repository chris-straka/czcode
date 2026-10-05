import type { EnvironmentId, ThreadId } from "@cz/contracts";
import { Box, Text, useApp, useInput } from "ink";
import { createElement as h, useState } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { ThreadListScreen } from "./ThreadListScreen.ts";

type Screen =
  | { readonly kind: "threads" }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export function App({ atoms }: { readonly atoms: TuiAtoms }) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "threads" });

  useInput((input, key) => {
    if (screen.kind === "threads" && input === "q") exit();
    if (screen.kind !== "threads" && key.escape) setScreen({ kind: "threads" });
  });

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { marginBottom: 1 },
      h(Text, { bold: true }, "Threads"),
      h(Text, { dimColor: true }, "  ↑↓/jk move · enter open · q quit"),
    ),
    screen.kind === "threads"
      ? h(ThreadListScreen, {
          atoms,
          active: true,
          onOpen: (environmentId, threadId) => setScreen({ kind: "thread", environmentId, threadId }),
        })
      : h(Text, null, `thread ${screen.threadId} (esc back)`),
  );
}
