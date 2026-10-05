import { useAtomValue } from "@effect/atom-react";
import { queuedRunStartLabel } from "@cz/client-runtime/state/queue";
import type { EnvironmentId, QueuedRun } from "@cz/contracts";
import { formatResetsIn, providersWithLimits, remainingPercent } from "@cz/shared/usageLimits";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo, useState, type ReactNode } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { useCommand } from "./command.ts";
import { useNow } from "./hooks.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface QueueRow {
  readonly environmentId: EnvironmentId;
  readonly host: string;
  readonly run: QueuedRun;
}

/** Queued runs on every host: waiting ones, plus the last day's failures. */
function queueRowsAtom(atoms: TuiAtoms, now: number) {
  return Atom.make((get) => {
    const catalog = get(atoms.catalog.catalogValueAtom);
    const rows: Array<QueueRow> = [];
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const runs = Option.getOrElse(
        AsyncResult.value(get(atoms.queue.list({ environmentId, input: null }))),
        (): ReadonlyArray<QueuedRun> => [],
      );
      for (const run of runs) {
        if (
          run.status === "queued" ||
          (run.status === "failed" && (run.startedAt ?? 0) > now - DAY_MS)
        ) {
          rows.push({ environmentId, host: entry.target.label, run });
        }
      }
    }
    return rows.sort((left, right) => left.run.dueAt - right.run.dueAt);
  });
}

const bar = (remaining: number, width = 10) => {
  const filled = Math.round((remaining / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
};

/**
 * Usage limits per host and provider, and the reset queue: runs that start
 * when a model's quota resets ("Run at next reset"). `r` runs one now,
 * `x` cancels it.
 */
export function QueueScreen(props: { readonly atoms: TuiAtoms; readonly active: boolean }) {
  const { atoms } = props;
  const now = useNow(30_000);
  const configs = useAtomValue(atoms.serverConfigsAtom);
  const catalog = useAtomValue(atoms.catalog.catalogValueAtom);
  const rowsAtom = useMemo(
    () => queueRowsAtom(atoms, Math.floor(now / 60_000) * 60_000),
    [atoms, now],
  );
  const rows = useAtomValue(rowsAtom);
  const [cursor, setCursor] = useState(0);
  const cancel = useCommand(atoms.queue.cancel);
  const runNow = useCommand(atoms.queue.runNow);
  const selected = rows[Math.min(cursor, Math.max(0, rows.length - 1))];

  useInput(
    (input, key) => {
      if (key.downArrow || input === "j") setCursor(Math.min(rows.length - 1, cursor + 1));
      else if (key.upArrow || input === "k") setCursor(Math.max(0, cursor - 1));
      else if (selected?.run.status === "queued" && input === "r") {
        void runNow({ environmentId: selected.environmentId, input: { id: selected.run.id } });
      } else if (selected?.run.status === "queued" && input === "x") {
        void cancel({ environmentId: selected.environmentId, input: { id: selected.run.id } });
      }
    },
    { isActive: props.active },
  );

  const limits: Array<ReactNode> = [];
  for (const [environmentId, config] of configs) {
    const host = catalog.entries.get(environmentId)?.target.label ?? "";
    for (const provider of providersWithLimits(config.providers)) {
      for (const window of provider.usageLimits?.windows ?? []) {
        const remaining = Math.round(remainingPercent(window));
        limits.push(
          h(
            Box,
            { key: `${environmentId}:${provider.instanceId}:${window.id}` },
            h(
              Box,
              { width: 20, flexShrink: 0 },
              h(
                Text,
                { wrap: "truncate" },
                `${configs.size > 1 ? `${host} ` : ""}${provider.displayName ?? provider.instanceId}`,
              ),
            ),
            h(Box, { width: 9, flexShrink: 0 }, h(Text, { dimColor: true }, window.label)),
            h(
              Text,
              { color: remaining < 15 ? "red" : remaining < 40 ? "yellow" : "green" },
              `${bar(remaining)} ${remaining}%`,
            ),
            h(Text, { dimColor: true, wrap: "truncate" }, ` ${formatResetsIn(window, now) ?? ""}`),
          ),
        );
      }
    }
  }

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Limits"),
    limits.length > 0 ? limits : h(Text, { dimColor: true }, "No provider reports limits."),
    h(Box, { marginTop: 1 }, h(Text, { bold: true }, "Queued for the next reset")),
    rows.length === 0
      ? h(Text, { dimColor: true }, "Nothing queued. (Run at next reset: ctrl+r on a new thread.)")
      : rows.map((row, index) =>
          h(
            Box,
            { key: `${row.environmentId}:${row.run.id}`, flexDirection: "column" },
            h(
              Text,
              { wrap: "truncate", ...(index === cursor ? { color: "cyan" } : {}) },
              `${index === cursor ? "› " : "  "}${row.run.title}`,
            ),
            h(
              Text,
              { dimColor: true, wrap: "truncate" },
              `    ${queuedRunStartLabel(row.run, now)} · ${row.run.modelSelection.model}${configs.size > 1 ? ` · ${row.host}` : ""}${row.run.error ? ` · ${row.run.error.split("\n")[0]}` : ""}`,
            ),
          ),
        ),
    rows.length > 0 ? h(Text, { dimColor: true }, "r run now · x cancel") : null,
  );
}
