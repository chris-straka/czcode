import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { queuedRunStartLabel } from "@cz/client-runtime/state/queue";
import type { EnvironmentId, QueuedRun } from "@cz/contracts";
import { formatResetsIn, providersWithLimits, remainingPercent } from "@cz/shared/usageLimits";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { Box, Text } from "ink";
import { createElement as h, useContext, useMemo, useState, type ReactNode } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { useCommand } from "./command.ts";
import { useNow } from "./hooks.ts";
import { useKeys, useVimMotion } from "./input.ts";
import { HostLoadLine, type HostResult, useHostLoads } from "./useHostLoads.ts";
import { anyLoading } from "../model/hostLoad.ts";

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
    const results: Array<HostResult> = [];
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const result = get(atoms.queue.list({ environmentId, input: null }));
      const value = Option.getOrNull(AsyncResult.value(result));
      results.push({
        environmentId,
        label: entry.target.label,
        hasValue: value !== null,
        failed: result._tag === "Failure",
      });
      const runs: ReadonlyArray<QueuedRun> = value ?? [];
      for (const run of runs) {
        if (
          run.status === "queued" ||
          (run.status === "failed" && (run.startedAt ?? 0) > now - DAY_MS)
        ) {
          rows.push({ environmentId, host: entry.target.label, run });
        }
      }
    }
    return { rows: rows.sort((left, right) => left.run.dueAt - right.run.dueAt), results };
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
  const { rows, results } = useAtomValue(rowsAtom);
  const loads = useHostLoads(atoms, results);
  const [cursor, setCursor] = useState(0);
  const cancel = useCommand(atoms.queue.cancel);
  const runNow = useCommand(atoms.queue.runNow);
  const selected = rows[Math.min(cursor, Math.max(0, rows.length - 1))];
  const registry = useContext(RegistryContext);
  const refresh = (environmentId: EnvironmentId) =>
    registry.refresh(atoms.queue.list({ environmentId, input: null }));

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (vim(input, key, { cursor, count: rows.length, page: 10, onMove: setCursor })) return;
      if (selected?.run.status === "queued" && input === "r") {
        const { environmentId } = selected;
        void runNow({ environmentId, input: { id: selected.run.id } }).then(() =>
          refresh(environmentId),
        );
      } else if (selected && input === "x") {
        // Cancels a waiting run; dismisses one that failed to start.
        const { environmentId } = selected;
        void cancel({ environmentId, input: { id: selected.run.id } }).then(() =>
          refresh(environmentId),
        );
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
            h(
              Box,
              { width: 15, flexShrink: 0 },
              h(Text, { dimColor: true, wrap: "truncate" }, window.label),
            ),
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
      ? h(
          Text,
          { dimColor: true },
          anyLoading(loads)
            ? "Loading the queue…"
            : "Nothing queued. (Run at next reset: ctrl+r on a new thread.)",
        )
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
    selected
      ? h(
          Text,
          { dimColor: true },
          selected.run.status === "failed" ? "x dismiss" : "r run now · x cancel",
        )
      : null,
    h(HostLoadLine, { hosts: loads }),
  );
}
