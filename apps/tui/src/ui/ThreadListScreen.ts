import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { resolveSnoozePresets } from "@cz/client-runtime/state/thread-settled";
import type { EnvironmentId, ThreadId } from "@cz/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { Box, type DOMElement, Text } from "ink";
import { createElement as h, useContext, useEffect, useMemo, useRef, useState } from "react";

import { projectKey } from "../model/scope.ts";
import {
  age,
  type EnvironmentShell,
  type ThreadListItem,
  type ThreadRow,
  type ThreadSection,
  threadKey,
  threadListItems,
  threadRows,
  threadState,
} from "../model/threadList.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { useNow, useViewport } from "./hooks.ts";
import { useClick, useKeys, useVimMotion } from "./input.ts";
import { Picker } from "./Picker.ts";
import { HostLoadLine, useHostLoads } from "./useHostLoads.ts";
import { anyLoading, hostLoadSummary } from "../model/hostLoad.ts";
import { TextInput } from "./TextInput.ts";

export interface ThreadListProps {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  /** Kept by the parent so the selection survives opening a thread and coming back. */
  readonly cursor: number;
  readonly onCursor: (cursor: number) => void;
  /** `environmentId:projectId` keys to show, or null for every project. */
  readonly scope: ReadonlySet<string> | null;
  /** True while the list takes typed text (search, rename) or shows a menu, so the app's keys stand down. */
  readonly onCaptureChange: (capturing: boolean) => void;
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

/** The archive on every enabled host, read once per visit to the Archived view. */
function archivedShellsAtom(atoms: TuiAtoms) {
  return Atom.make((get): ReadonlyArray<EnvironmentShell> => {
    const catalog = get(atoms.catalog.catalogValueAtom);
    const shells: Array<EnvironmentShell> = [];
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const result = get(atoms.orchestration.archivedShellSnapshot({ environmentId, input: {} }));
      const snapshot = Option.getOrNull(AsyncResult.value(result));
      shells.push({
        environmentId,
        label: entry.target.label,
        snapshot: snapshot && { ...snapshot, archivedThreads: [] },
      });
    }
    return shells;
  });
}

/** Thread keys whose messages match `query` on any host (the server needs 2+ characters). */
function messageMatchesAtom(atoms: TuiAtoms, query: string) {
  return Atom.make((get): ReadonlySet<string> => {
    const keys = new Set<string>();
    if (query.trim().length < 2) return keys;
    const catalog = get(atoms.catalog.catalogValueAtom);
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const result = get(
        atoms.orchestration.threadSearch({
          environmentId,
          input: { query: query.trim(), limit: 50 },
        }),
      );
      for (const match of Option.getOrNull(AsyncResult.value(result))?.matches ?? []) {
        keys.add(`${environmentId}:${match.threadId}`);
      }
    }
    return keys;
  });
}

type Mode =
  | { readonly kind: "browse" }
  | { readonly kind: "search" }
  | { readonly kind: "rename"; readonly row: ThreadRow; readonly title: string }
  | { readonly kind: "snooze"; readonly row: ThreadRow }
  | { readonly kind: "delete"; readonly row: ThreadRow };

const SECTION_TITLE: Record<ThreadSection, string> = {
  pinned: "Pinned",
  active: "Active",
  snoozed: "Snoozed",
  settled: "Settled",
};

/**
 * Threads on every host, on the desktop sidebar's shelves. Enter opens (or
 * folds a shelf), `/` searches titles and messages, and the lifecycle keys
 * act on the selected thread: s settle, p pin, z snooze/wake, x archive,
 * R rename, D delete, u undoes the last one. `v` shows the archive.
 */
export function ThreadListScreen({
  atoms,
  active,
  onOpen,
  cursor,
  onCursor: setCursor,
  scope,
  onCaptureChange,
}: ThreadListProps) {
  const registry = useContext(RegistryContext);
  const setStatus = useContext(StatusContext);
  const [archived, setArchived] = useState(false);
  const shellsAtom = useMemo(
    () => (archived ? archivedShellsAtom(atoms) : environmentShellsAtom(atoms)),
    [atoms, archived],
  );
  const shells = useAtomValue(shellsAtom);
  const [mode, setModeState] = useState<Mode>({ kind: "browse" });
  const setMode = (next: Mode) => {
    setModeState(next);
    onCaptureChange(next.kind !== "browse");
  };
  const [query, setQuery] = useState("");
  // The server search runs once typing pauses, not per keystroke.
  const [searchedQuery, setSearchedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const matchesAtom = useMemo(
    () => messageMatchesAtom(atoms, searchedQuery),
    [atoms, searchedQuery],
  );
  const messageMatches = useAtomValue(matchesAtom);
  const [unfolded, setUnfolded] = useState<ReadonlySet<ThreadSection>>(new Set());
  const [undo, setUndo] = useState<{ readonly label: string; readonly run: () => void } | null>(
    null,
  );
  const now = useNow(30_000);
  const rows = useMemo(
    () =>
      threadRows(shells, { archived }).filter(
        (row) => scope === null || scope.has(projectKey(row.environmentId, row.thread.projectId)),
      ),
    [shells, scope, archived],
  );
  const items = useMemo(
    () =>
      archived
        ? threadListItems(rows, { nowMs: now, unfolded, query }).map((item): ThreadListItem =>
            item.kind === "thread" ? { ...item, section: "active" } : item,
          )
        : threadListItems(rows, { nowMs: now, unfolded, query, messageMatches }),
    [rows, now, unfolded, query, messageMatches, archived],
  );

  const settle = useCommand(atoms.threadEnvironment.settle);
  const unsettle = useCommand(atoms.threadEnvironment.unsettle);
  const pin = useCommand(atoms.threadEnvironment.pin);
  const unpin = useCommand(atoms.threadEnvironment.unpin);
  const snooze = useCommand(atoms.threadEnvironment.snooze);
  const unsnooze = useCommand(atoms.threadEnvironment.unsnooze);
  const archive = useCommand(atoms.threadEnvironment.archive);
  const unarchive = useCommand(atoms.threadEnvironment.unarchive);
  const remove = useCommand(atoms.threadEnvironment.delete);
  const updateMetadata = useCommand(atoms.threadEnvironment.updateMetadata);

  // Connecting normally takes a moment; after that, say what to check.
  const [slowStart, setSlowStart] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlowStart(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const { rows: height, columns } = useViewport();
  const loads = useHostLoads(
    atoms,
    shells.map((shell) => ({
      environmentId: shell.environmentId,
      label: shell.label,
      hasValue: shell.snapshot !== null,
      failed: false,
    })),
  );
  const loadLine = hostLoadSummary(loads) !== null ? 1 : 0;
  const footerLines = (mode.kind === "browse" || mode.kind === "search" ? 1 : 3) + loadLine;
  const visible = Math.max(3, height - 4 - footerLines);
  const selected = Math.min(cursor, Math.max(0, items.length - 1));
  const top = Math.max(0, Math.min(selected - Math.floor(visible / 2), items.length - visible));
  const current = items[selected];
  const currentRow = current?.kind === "thread" ? current.row : null;

  const refreshArchive = (environmentId: EnvironmentId) =>
    registry.refresh(atoms.orchestration.archivedShellSnapshot({ environmentId, input: {} }));
  const ref = (row: ThreadRow) => ({
    environmentId: row.environmentId,
    input: { threadId: row.thread.id },
  });

  /** Runs a lifecycle action and remembers its reverse for `u`. */
  const act = (label: string, run: () => Promise<unknown>, reverse: () => Promise<unknown>) => {
    void run().then((result) => {
      if (result === null) return;
      setStatus(`${label} · u undo`);
      setUndo({ label, run: () => void reverse() });
    });
  };

  const toggleSettle = (row: ThreadRow, section: ThreadSection) =>
    section === "settled"
      ? act(
          "Unsettled",
          () => unsettle({ ...ref(row), input: { threadId: row.thread.id, reason: "user" } }),
          () => settle(ref(row)),
        )
      : act(
          "Settled",
          () => settle(ref(row)),
          () => unsettle({ ...ref(row), input: { threadId: row.thread.id, reason: "user" } }),
        );
  const togglePin = (row: ThreadRow) =>
    row.thread.pinnedAt != null
      ? act(
          "Unpinned",
          () => unpin(ref(row)),
          () => pin(ref(row)),
        )
      : act(
          "Pinned",
          () => pin(ref(row)),
          () => unpin(ref(row)),
        );
  const wake = (row: ThreadRow) =>
    act(
      "Woke",
      () => unsnooze({ ...ref(row), input: { threadId: row.thread.id, reason: "user" } }),
      () =>
        row.thread.snoozedUntil
          ? snooze({
              ...ref(row),
              input: {
                threadId: row.thread.id,
                snoozedUntil: DateTime.formatIso(row.thread.snoozedUntil),
              },
            })
          : Promise.resolve(null),
    );
  const toggleArchive = (row: ThreadRow) =>
    archived
      ? act(
          "Unarchived",
          () => unarchive(ref(row)).finally(() => refreshArchive(row.environmentId)),
          () => archive(ref(row)).finally(() => refreshArchive(row.environmentId)),
        )
      : act(
          "Archived",
          () => archive(ref(row)),
          () => unarchive(ref(row)),
        );

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (
        vim(input, key, { cursor: selected, count: items.length, page: visible, onMove: setCursor })
      )
        return;
      if (input === "/") return setMode({ kind: "search" });
      if (key.escape && query) {
        setQuery("");
        return setCursor(0);
      }
      if (input === "v") {
        setArchived(!archived);
        setQuery("");
        return setCursor(0);
      }
      if (input === "u" && undo) {
        undo.run();
        setStatus(`Undid: ${undo.label.toLowerCase()}`);
        return setUndo(null);
      }
      if (key.return) {
        if (current?.kind === "header") {
          const next = new Set(unfolded);
          if (next.has(current.section)) next.delete(current.section);
          else next.add(current.section);
          return setUnfolded(next);
        }
        if (currentRow) onOpen(currentRow.environmentId, currentRow.thread.id);
        return;
      }
      if (!currentRow || current?.kind !== "thread") return;
      if (input === "x") return toggleArchive(currentRow);
      if (input === "R")
        return setMode({ kind: "rename", row: currentRow, title: currentRow.thread.title });
      if (input === "D") return setMode({ kind: "delete", row: currentRow });
      if (archived) return;
      if (input === "s") return toggleSettle(currentRow, current.section);
      if (input === "p") return togglePin(currentRow);
      if (input === "z") {
        if (current.section === "snoozed") return wake(currentRow);
        if (currentRow.thread.pendingRuntimeRequest !== null)
          return setStatus("It's waiting on you; answer it before snoozing.");
        return setMode({ kind: "snooze", row: currentRow });
      }
    },
    { isActive: active && mode.kind === "browse" },
  );
  useKeys(
    (_input, key) => {
      if (key.escape) {
        if (mode.kind === "search") setQuery("");
        setMode({ kind: "browse" });
        return;
      }
      if (mode.kind === "delete" && _input === "y") {
        const row = mode.row;
        setMode({ kind: "browse" });
        void remove(ref(row)).then((result) => {
          if (result === null) return;
          setStatus(`Deleted "${row.thread.title}".`);
          if (archived) refreshArchive(row.environmentId);
        });
      } else if (mode.kind === "delete") setMode({ kind: "browse" });
    },
    {
      isActive:
        active && (mode.kind === "search" || mode.kind === "rename" || mode.kind === "delete"),
    },
  );
  const list = useRef<DOMElement>(null);
  // A click selects a row; a click on the selected row opens it.
  useClick(
    list,
    ({ row: offset }) => {
      const index = top + offset;
      const item = items[index];
      if (!item) return;
      if (index !== selected) return setCursor(index);
      if (item.kind === "thread") onOpen(item.row.environmentId, item.row.thread.id);
    },
    active && mode.kind === "browse",
  );

  if (mode.kind === "snooze") {
    const row = mode.row;
    return h(Picker<string>, {
      title: `Snooze "${row.thread.title}" until`,
      choices: resolveSnoozePresets(new Date()).map((preset) => ({
        label: preset.label,
        detail: preset.whenLabel,
        value: preset.snoozedUntil,
      })),
      active,
      onCancel: () => setMode({ kind: "browse" }),
      onPick: (snoozedUntil) => {
        setMode({ kind: "browse" });
        act(
          "Snoozed",
          () => snooze({ ...ref(row), input: { threadId: row.thread.id, snoozedUntil } }),
          () => unsnooze({ ...ref(row), input: { threadId: row.thread.id, reason: "user" } }),
        );
      },
    });
  }

  if (shells.length === 0) {
    return h(
      Text,
      { dimColor: true },
      slowStart
        ? "No machine connected. Is czcode open on this machine (or cz serve running)? Other machines pair in Hosts (4)."
        : "Connecting…",
    );
  }

  const showEnvironment = shells.length > 1;
  const stateWidth = 10;
  const ageWidth = 4;
  const projectWidth = Math.min(16, Math.floor(columns / 4));
  const footer =
    mode.kind === "search"
      ? h(
          Box,
          null,
          h(Text, { color: "cyan" }, "/"),
          h(TextInput, {
            value: query,
            active,
            placeholder: "search titles and messages",
            onChange: (value) => {
              setQuery(value);
              setCursor(0);
            },
            onSubmit: () => setMode({ kind: "browse" }),
          }),
        )
      : mode.kind === "rename"
        ? h(
            Box,
            { flexDirection: "column" },
            h(Text, null, "Rename (enter saves, esc cancels):"),
            h(TextInput, {
              value: mode.title,
              active,
              onChange: (title) => setMode({ ...mode, title }),
              onSubmit: (title) => {
                const row = mode.row;
                setMode({ kind: "browse" });
                if (title.trim() === "" || title === row.thread.title) return;
                void updateMetadata({
                  ...ref(row),
                  input: { threadId: row.thread.id, title: title.trim() },
                });
              },
            }),
          )
        : mode.kind === "delete"
          ? h(
              Box,
              { flexDirection: "column" },
              h(Text, { color: "red", wrap: "truncate" }, `Delete "${mode.row.thread.title}"?`),
              h(
                Text,
                { dimColor: true },
                "This can't be undone. y delete · any other key keeps it",
              ),
            )
          : h(
              Text,
              { dimColor: true, wrap: "truncate" },
              archived
                ? "Archived · x unarchive · D delete · / search · v back"
                : `${query ? `/${query} · esc clear · ` : ""}s settle · p pin · z snooze · x archive · R rename · / search · v archived${undo ? " · u undo" : ""}`,
            );

  const body =
    items.length === 0
      ? h(
          Text,
          { dimColor: true },
          query
            ? "Nothing matches."
            : anyLoading(loads)
              ? "Loading threads…"
              : archived
                ? "Nothing archived."
                : "No threads yet.",
        )
      : h(
          Box,
          { ref: list, flexDirection: "column", height: Math.min(visible, items.length) },
          items.slice(top, top + visible).map((item, offset) => {
            const index = top + offset;
            const isSelected = index === selected;
            if (item.kind === "header") {
              return h(
                Box,
                { key: `header:${item.section}` },
                h(
                  Box,
                  { width: 2, flexShrink: 0 },
                  h(Text, { color: "cyan" }, isSelected ? "›" : " "),
                ),
                h(
                  Text,
                  { dimColor: !isSelected, bold: isSelected },
                  `${item.expanded ? "▾" : "▸"} ${SECTION_TITLE[item.section]} (${item.count})`,
                ),
              );
            }
            const { row } = item;
            const state = threadState(row.thread);
            const project = showEnvironment
              ? `${row.environmentLabel}/${row.projectTitle}`
              : row.projectTitle;
            const marker = item.section === "pinned" ? "▪ " : "";
            return h(
              Box,
              { key: threadKey(row) },
              h(
                Box,
                { width: 2, flexShrink: 0 },
                h(Text, { color: "cyan" }, isSelected ? "›" : " "),
              ),
              h(
                Box,
                { width: projectWidth, marginRight: 1, flexShrink: 0 },
                h(Text, { dimColor: true, wrap: "truncate" }, project),
              ),
              h(
                Box,
                { flexGrow: 1, marginRight: 1 },
                h(
                  Text,
                  {
                    bold: isSelected,
                    dimColor: item.section === "settled" || item.section === "snoozed",
                    wrap: "truncate",
                  },
                  `${marker}${row.thread.title || "Untitled"}`,
                ),
              ),
              h(
                Box,
                { width: stateWidth, flexShrink: 0 },
                h(
                  Text,
                  {
                    color: state === "needs you" ? "yellow" : state === "failed" ? "red" : "green",
                  },
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
  return h(
    Box,
    { flexDirection: "column" },
    body,
    h(HostLoadLine, { hosts: loads }),
    h(Box, { marginTop: 1 }, footer),
  );
}
