import { useAtomValue } from "@effect/atom-react";
import type { DecisionItemWithAnswer, EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { Box, type DOMElement, Text } from "ink";
import { createElement as h, useMemo, useRef, useState } from "react";

import { type DecisionEntry, decisionFeed, KIND_TAG } from "../model/decisionFeed.ts";
import { age } from "../model/threadList.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { DecisionScreen } from "./DecisionScreen.ts";
import { useNow, useViewport } from "./hooks.ts";
import { useClick, useKeys } from "./input.ts";
import { HostLoadLine, type HostResult, useHostLoads } from "./useHostLoads.ts";
import { anyLoading } from "../model/hostLoad.ts";

interface HostDecisions {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly items: ReadonlyArray<DecisionItemWithAnswer>;
}

/** Open decisions on every enabled host (each host re-reads on its own interval). */
export function openDecisionsAtom(atoms: TuiAtoms) {
  return Atom.make((get) => {
    const catalog = get(atoms.catalog.catalogValueAtom);
    const hosts: Array<HostDecisions> = [];
    const results: Array<HostResult> = [];
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const result = get(atoms.decisions.list({ environmentId, input: { status: "open" } }));
      const items = Option.getOrNull(AsyncResult.value(result));
      const label = entry.target.label;
      results.push({ environmentId, label, hasValue: items !== null, failed: result._tag === "Failure" });
      if (items !== null) hosts.push({ environmentId, label, items });
    }
    return { hosts, results };
  });
}

/** The Decisions tab: the feed, then one decision full screen. */
export function DecisionsScreen(props: {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
  readonly scopeNames: ReadonlySet<string> | null;
  /** Lets the app hide its tab bar while a decision is open. */
  readonly onOpenChange: (open: boolean) => void;
}) {
  const feedAtom = useMemo(() => openDecisionsAtom(props.atoms), [props.atoms]);
  const { hosts, results } = useAtomValue(feedAtom);
  const loads = useHostLoads(props.atoms, results);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const entries = useMemo(
    () => decisionFeed(hosts, props.scopeNames).filter((entry) => !answered.has(entry.item.id)),
    [hosts, props.scopeNames, answered],
  );
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<DecisionEntry | null>(null);
  const now = useNow(60_000);
  const { rows: height, columns } = useViewport();
  const visible = Math.max(3, height - 5);
  const selected = Math.min(cursor, Math.max(0, entries.length - 1));
  const top = Math.max(0, Math.min(selected - Math.floor(visible / 2), entries.length - visible));
  const openEntry = (entry: DecisionEntry) => {
    setOpen(entry);
    props.onOpenChange(true);
  };

  useKeys(
    (input, key) => {
      if (key.downArrow || input === "j") setCursor(Math.min(entries.length - 1, selected + 1));
      else if (key.upArrow || input === "k") setCursor(Math.max(0, selected - 1));
      else if (key.return && entries[selected]) openEntry(entries[selected]);
    },
    { isActive: props.active && open === null },
  );
  const list = useRef<DOMElement>(null);
  // A click selects a row; a click on the selected row opens it.
  useClick(
    list,
    ({ row }) => {
      const index = top + row;
      if (index === selected && entries[index]) openEntry(entries[index]);
      else if (index < entries.length) setCursor(index);
    },
    props.active && open === null,
  );

  if (open) {
    return h(DecisionScreen, {
      key: open.item.id,
      atoms: props.atoms,
      entry: open,
      active: props.active,
      onDone: () => {
        // The list re-reads on its interval; hide an answered item until then.
        if (open.item.status === "open") setAnswered(new Set([...answered, open.item.id]));
        setOpen(null);
        props.onOpenChange(false);
      },
    });
  }
  if (entries.length === 0) {
    return h(
      Box,
      { flexDirection: "column" },
      h(
        Text,
        { dimColor: true },
        anyLoading(loads) ? "Loading decisions…" : "Nothing waiting on you.",
      ),
      h(HostLoadLine, { hosts: loads }),
    );
  }
  const tagWidth = 7;
  const projectWidth = Math.min(14, Math.floor(columns / 5));
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { ref: list, flexDirection: "column" },
      entries.slice(top, top + visible).map((entry, offset) => {
      const index = top + offset;
      const focused = index === selected;
      return h(
        Box,
        { key: `${entry.environmentId}:${entry.item.id}` },
        h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: "cyan" }, focused ? "›" : " ")),
        h(
          Box,
          { width: tagWidth, flexShrink: 0 },
          h(
            Text,
            entry.item.blocking ? { color: "yellow" } : { dimColor: true },
            KIND_TAG[entry.item.kind],
          ),
        ),
        h(
          Box,
          { width: projectWidth, flexShrink: 0, marginRight: 1 },
          h(Text, { dimColor: true, wrap: "truncate" }, entry.item.project),
        ),
        h(
          Box,
          { flexGrow: 1, marginRight: 1 },
          h(Text, { bold: focused, wrap: "truncate" }, entry.item.title || entry.item.question),
        ),
        h(
          Box,
          { width: 4, flexShrink: 0, justifyContent: "flex-end" },
          h(Text, { dimColor: true }, age(now, entry.item.created_at)),
        ),
      );
    }),
    ),
    h(HostLoadLine, { hosts: loads }),
  );
}
