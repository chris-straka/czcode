import type { EnvironmentId, ThreadId } from "@cz/contracts";
import { Box, type DOMElement, Text, useApp } from "ink";
import { useAtomValue } from "@effect/atom-react";
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext } from "./command.ts";
import { HostsScreen } from "./HostsScreen.ts";
import { NewThreadScreen } from "./NewThreadScreen.ts";
import { projectScope } from "../model/scope.ts";
import { DecisionsScreen } from "./DecisionsScreen.ts";
import { DiffScreen } from "./DiffScreen.ts";
import { QueueScreen } from "./QueueScreen.ts";
import { environmentShellsAtom, ThreadListScreen } from "./ThreadListScreen.ts";
import { ThreadScreen } from "./ThreadScreen.ts";
import { useClick, useKeys, useMouseRouter } from "./input.ts";

const TABS = ["Threads", "Decisions", "Queue", "Hosts"] as const;
type Tab = (typeof TABS)[number];

type Overlay =
  | { readonly kind: "none" }
  | { readonly kind: "new-thread" }
  | { readonly kind: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | {
      readonly kind: "diff";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly toTurnCount: number;
    };

/**
 * Tabs across the top (1-2 or Tab to switch), one screen below, a status line
 * at the bottom. Keys stay off `\` and `|` (the owner's float toggle and
 * terminal-normal exit) and Cmd chords; Esc always goes back.
 */
export function App({ atoms, cwd }: { readonly atoms: TuiAtoms; readonly cwd: string }) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>("Threads");
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [listCursor, setListCursor] = useState(0);
  const [decisionOpen, setDecisionOpen] = useState(false);
  // Opens on the project containing the cwd (one Ghostty tab per project); `a` shows all.
  const [allProjects, setAllProjects] = useState(false);
  const shellsAtom = useMemo(() => environmentShellsAtom(atoms), [atoms]);
  const shells = useAtomValue(shellsAtom);
  const scope = useMemo(() => projectScope(shells, cwd), [shells, cwd]);
  const scopeKeys = allProjects || scope === null ? null : scope.keys;
  const [status, setStatusText] = useState("");
  const setStatus = useCallback((message: string) => setStatusText(message), []);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatusText(""), 8000);
    return () => clearTimeout(timer);
  }, [status]);

  const atTop = overlay.kind === "none" && !decisionOpen;
  useMouseRouter();
  const tabBar = useRef<DOMElement>(null);
  useClick(
    tabBar,
    ({ column }) => {
      let start = 0;
      for (const [index, name] of TABS.entries()) {
        const width = `${index + 1} ${name}`.length;
        if (column >= start && column < start + width) return setTab(name);
        start += width + 2;
      }
    },
    atTop,
  );
  useKeys(
    (input, key) => {
      if (input === "q") return exit();
      const digit = Number(input);
      if (digit >= 1 && digit <= TABS.length) return setTab(TABS[digit - 1] ?? "Threads");
      if (key.tab) return setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "Threads");
      if (input === "n" && tab === "Threads") setOverlay({ kind: "new-thread" });
      if (input === "a" && scope !== null) {
        setAllProjects(!allProjects);
        setListCursor(0);
      }
    },
    { isActive: atTop },
  );

  const back = () => setOverlay({ kind: "none" });
  const openThread = (environmentId: EnvironmentId, threadId: ThreadId) =>
    setOverlay({ kind: "thread", environmentId, threadId });

  let body;
  if (overlay.kind === "diff") {
    const { environmentId, threadId } = overlay;
    body = h(DiffScreen, {
      key: `diff:${threadId}`,
      atoms,
      ...overlay,
      active: true,
      onBack: () => setOverlay({ kind: "thread", environmentId, threadId }),
    });
  } else if (overlay.kind === "thread") {
    body = h(ThreadScreen, {
      key: overlay.threadId,
      atoms,
      ...overlay,
      active: true,
      onBack: back,
      onDiff: (toTurnCount: number) => setOverlay({ ...overlay, kind: "diff", toTurnCount }),
    });
  } else if (overlay.kind === "new-thread") {
    body = h(NewThreadScreen, {
      atoms,
      active: true,
      onStarted: openThread,
      onCancel: back,
      scope: scope?.keys ?? null,
    });
  } else if (tab === "Decisions") {
    body = h(DecisionsScreen, {
      atoms,
      active: true,
      scopeNames: allProjects || scope === null ? null : scope.names,
      onOpenChange: setDecisionOpen,
    });
  } else if (tab === "Queue") {
    body = h(QueueScreen, { atoms, active: true });
  } else if (tab === "Hosts") {
    body = h(HostsScreen, { atoms, active: true });
  } else {
    body = h(ThreadListScreen, {
      atoms,
      active: true,
      onOpen: openThread,
      cursor: listCursor,
      onCursor: setListCursor,
      scope: scopeKeys,
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
            { flexDirection: "column", marginBottom: 1 },
            h(
              Box,
              { ref: tabBar },
              ...TABS.map((name, index) =>
                h(
                  Box,
                  { key: name, marginRight: 2, flexShrink: 0 },
                  h(
                    Text,
                    name === tab ? { bold: true, color: "cyan" } : { dimColor: true },
                    `${index + 1} ${name}`,
                  ),
                ),
              ),
            ),
            h(
              Text,
              { dimColor: true, wrap: "truncate" },
              `${scope ? (scopeKeys ? `${scope.title} · a all` : "all projects · a this project") : "all projects"}${tab === "Threads" ? " · n new" : ""} · q quit`,
            ),
          )
        : null,
      body,
      status ? h(Text, { color: "yellow", wrap: "truncate" }, status) : null,
    ),
  );
}
