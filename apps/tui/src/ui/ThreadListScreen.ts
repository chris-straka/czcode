import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@cz/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { Box, type DOMElement, Text } from "ink";
import { createElement as h, useMemo, useRef } from "react";

import { projectKey } from "../model/scope.ts";
import { age, type EnvironmentShell, threadRows, threadState } from "../model/threadList.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { useNow, useViewport } from "./hooks.ts";
import { useClick, useKeys } from "./input.ts";

export interface ThreadListProps {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  /** Kept by the parent so the selection survives opening a thread and coming back. */
  readonly cursor: number;
  readonly onCursor: (cursor: number) => void;
  /** `environmentId:projectId` keys to show, or null for every project. */
  readonly scope: ReadonlySet<string> | null;
}

/** Every environment's shell, as one value the list can render from. */
export function environmentShellsAtom(atoms: TuiAtoms) {
  return Atom.make((get): ReadonlyArray<EnvironmentShell> => {
    const catalog = get(atoms.catalog.catalogValueAtom);
    const shells: Array<EnvironmentShell> = [];
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const state = get(atoms.shell.stateValueAtom(environmentId));
      shells.push({
        environmentId,
        label: entry.target.label,
        snapshot: Option.getOrNull(state.snapshot),
      });
    }
    return shells;
  });
}

export function ThreadListScreen({
  atoms,
  active,
  onOpen,
  cursor,
  onCursor: setCursor,
  scope,
}: ThreadListProps) {
  const shellsAtom = useMemo(() => environmentShellsAtom(atoms), [atoms]);
  const shells = useAtomValue(shellsAtom);
  const rows = useMemo(
    () =>
      threadRows(shells).filter(
        (row) => scope === null || scope.has(projectKey(row.environmentId, row.thread.projectId)),
      ),
    [shells, scope],
  );
  const now = useNow(30_000);
  const { rows: height, columns } = useViewport();
  const visible = Math.max(3, height - 4);
  const selected = Math.min(cursor, Math.max(0, rows.length - 1));
  const top = Math.max(0, Math.min(selected - Math.floor(visible / 2), rows.length - visible));

  useKeys(
    (input, key) => {
      if (key.downArrow || input === "j") setCursor(Math.min(rows.length - 1, selected + 1));
      else if (key.upArrow || input === "k") setCursor(Math.max(0, selected - 1));
      else if (input === "g") setCursor(0);
      else if (input === "G") setCursor(Math.max(0, rows.length - 1));
      else if (key.return) {
        const row = rows[selected];
        if (row) onOpen(row.environmentId, row.thread.id);
      }
    },
    { isActive: active },
  );
  const list = useRef<DOMElement>(null);
  // A click selects a row; a click on the selected row opens it.
  useClick(
    list,
    ({ row: offset }) => {
      const index = top + offset;
      const row = rows[index];
      if (!row) return;
      if (index === selected) onOpen(row.environmentId, row.thread.id);
      else setCursor(index);
    },
    active,
  );

  if (shells.length === 0) {
    return h(Text, { dimColor: true }, "Connecting… (no environments yet)");
  }
  if (rows.length === 0) {
    return h(Text, { dimColor: true }, "No threads yet.");
  }
  const showEnvironment = shells.length > 1;
  const stateWidth = 10;
  const ageWidth = 4;
  const projectWidth = Math.min(16, Math.floor(columns / 4));
  return h(
    Box,
    { ref: list, flexDirection: "column" },
    rows.slice(top, top + visible).map((row, offset) => {
      const index = top + offset;
      const isSelected = index === selected;
      const state = threadState(row.thread);
      const project = showEnvironment
        ? `${row.environmentLabel}/${row.projectTitle}`
        : row.projectTitle;
      return h(
        Box,
        { key: `${row.environmentId}:${row.thread.id}` },
        h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: "cyan" }, isSelected ? "›" : " ")),
        h(
          Box,
          { width: projectWidth, marginRight: 1, flexShrink: 0 },
          h(Text, { dimColor: true, wrap: "truncate" }, project),
        ),
        h(
          Box,
          { flexGrow: 1, marginRight: 1 },
          h(Text, { bold: isSelected, wrap: "truncate" }, row.thread.title || "Untitled"),
        ),
        h(
          Box,
          { width: stateWidth, flexShrink: 0 },
          h(
            Text,
            { color: state === "needs you" ? "yellow" : state === "failed" ? "red" : "green" },
            state,
          ),
        ),
        h(
          Box,
          { width: ageWidth, flexShrink: 0, justifyContent: "flex-end" },
          h(Text, { dimColor: true }, age(now, row.updatedAtMs)),
        ),
      );
    }),
  );
}
