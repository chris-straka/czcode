import type { EnvironmentId, ThreadId } from "@cz/contracts";
import { Box, Text, useApp, useInput } from "ink";
import { createElement as h, useCallback, useEffect, useState } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext } from "./command.ts";
import { HostsScreen } from "./HostsScreen.ts";
import { NewThreadScreen } from "./NewThreadScreen.ts";
import { ThreadListScreen } from "./ThreadListScreen.ts";
import { ThreadScreen } from "./ThreadScreen.ts";

const TABS = ["Threads", "Hosts"] as const;
type Tab = (typeof TABS)[number];

type Overlay =
  | { readonly kind: "none" }
  | { readonly kind: "new-thread" }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * Tabs across the top (1-2 or Tab to switch), one screen below, a status line
 * at the bottom. Keys stay off `\` and `|` (the owner's float toggle and
 * terminal-normal exit) and Cmd chords; Esc always goes back.
 */
export function App({ atoms }: { readonly atoms: TuiAtoms }) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>("Threads");
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [listCursor, setListCursor] = useState(0);
  const [status, setStatusText] = useState("");
  const setStatus = useCallback((message: string) => setStatusText(message), []);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatusText(""), 8000);
    return () => clearTimeout(timer);
  }, [status]);

  const atTop = overlay.kind === "none";
  useInput(
    (input, key) => {
      if (input === "q") return exit();
      const digit = Number(input);
      if (digit >= 1 && digit <= TABS.length) return setTab(TABS[digit - 1] ?? "Threads");
      if (key.tab) return setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "Threads");
      if (input === "n" && tab === "Threads") setOverlay({ kind: "new-thread" });
    },
    { isActive: atTop },
  );

  const back = () => setOverlay({ kind: "none" });
  const openThread = (environmentId: EnvironmentId, threadId: ThreadId) =>
    setOverlay({ kind: "thread", environmentId, threadId });

  let body;
  if (overlay.kind === "thread") {
    body = h(ThreadScreen, {
      key: overlay.threadId,
      atoms,
      ...overlay,
      active: true,
      onBack: back,
    });
  } else if (overlay.kind === "new-thread") {
    body = h(NewThreadScreen, { atoms, active: true, onStarted: openThread, onCancel: back });
  } else if (tab === "Hosts") {
    body = h(HostsScreen, { atoms, active: true });
  } else {
    body = h(ThreadListScreen, {
      atoms,
      active: true,
      onOpen: openThread,
      cursor: listCursor,
      onCursor: setListCursor,
    });
  }

  return h(
    StatusContext.Provider,
    { value: setStatus },
    h(
      Box,
      { flexDirection: "column" },
      atTop
        ? h(
            Box,
            { marginBottom: 1 },
            ...TABS.map((name, index) =>
              h(
                Text,
                {
                  key: name,
                  ...(name === tab ? { bold: true, color: "cyan" } : { dimColor: true }),
                },
                `${index + 1} ${name}  `,
              ),
            ),
            h(Text, { dimColor: true }, tab === "Threads" ? "n new · q quit" : "q quit"),
          )
        : null,
      body,
      status ? h(Text, { color: "red", wrap: "truncate" }, status) : null,
    ),
  );
}
