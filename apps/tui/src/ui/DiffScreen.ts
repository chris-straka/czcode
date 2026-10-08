import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Box, Text } from "ink";
import { createElement as h, useMemo, useState } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { useViewport } from "./hooks.ts";
import { useKeys, useVimMotion } from "./input.ts";

const lineColor = (line: string) =>
  line.startsWith("+++") || line.startsWith("---")
    ? { bold: true }
    : line.startsWith("+")
      ? { color: "green" }
      : line.startsWith("-")
        ? { color: "red" }
        : line.startsWith("@@")
          ? { color: "cyan" }
          : line.startsWith("diff ")
            ? { bold: true, color: "yellow" }
            : {};

/** What the thread changed, one turn at a time or all together, from the host (works for threads on any machine). */
export function DiffScreen(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly toTurnCount: number;
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  // Opens on the latest turn, like the desktop's diff panel; `a` shows the whole thread.
  const [turn, setTurn] = useState(props.toTurnCount);
  const [whole, setWhole] = useState(false);
  const result = useAtomValue(
    whole
      ? props.atoms.orchestration.fullThreadDiff({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, toTurnCount: props.toTurnCount },
        })
      : props.atoms.orchestration.turnDiff({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, fromTurnCount: turn - 1, toTurnCount: turn },
        }),
  );
  const { rows: height, columns } = useViewport();
  const [top, setTop] = useState(0);
  const showTurn = (next: number) => {
    setWhole(false);
    setTurn(Math.max(1, Math.min(props.toTurnCount, next)));
    setTop(0);
  };
  const diff = Option.getOrNull(AsyncResult.value(result))?.diff ?? null;
  const lines = useMemo(() => (diff ?? "").split("\n"), [diff]);
  const visible = Math.max(3, height - 3);
  const maxTop = Math.max(0, lines.length - visible);

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (key.escape || input === "d") return props.onBack();
      if (input === "<" || key.leftArrow) return showTurn(turn - 1);
      if (input === ">" || key.rightArrow) return showTurn(turn + 1);
      if (input === "a") {
        setWhole(!whole);
        return setTop(0);
      }
      if (
        vim(input, key, {
          cursor: top,
          count: maxTop + 1,
          page: visible,
          onMove: setTop,
          onBack: props.onBack,
        })
      )
        return;
      if (input === " ") setTop(Math.min(maxTop, top + visible - 1));
      else if (input === "]") {
        const next = lines.findIndex((line, index) => index > top && line.startsWith("diff "));
        if (next >= 0) setTop(Math.min(maxTop, next));
      } else if (input === "[") {
        const previous = lines.findLastIndex(
          (line, index) => index < top && line.startsWith("diff "),
        );
        if (previous >= 0) setTop(previous);
      }
    },
    { isActive: props.active },
  );

  if (diff === null) {
    return h(
      Text,
      { dimColor: true },
      result._tag === "Failure" ? "Couldn't load the diff." : "Loading diff…",
    );
  }
  const scopeLabel = whole ? "all turns" : `turn ${turn}/${props.toTurnCount}`;
  const keys = `</> turn · a ${whole ? "one turn" : "all turns"}`;
  if (diff.trim() === "")
    return h(Text, { dimColor: true }, `No changes in ${scopeLabel}. ${keys} · q back`);
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { flexDirection: "column", height: visible },
      lines
        .slice(top, top + visible)
        .map((line, index) =>
          h(
            Text,
            { key: top + index, wrap: "truncate", ...lineColor(line) },
            line.slice(0, columns + 20) || " ",
          ),
        ),
    ),
    h(
      Text,
      { dimColor: true },
      `${scopeLabel} · ${top + 1}-${Math.min(lines.length, top + visible)}/${lines.length} · ]/[ file · ${keys} · q back`,
    ),
  );
}
