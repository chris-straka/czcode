import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo, useState } from "react";

import type { TuiAtoms } from "../state/atoms.ts";
import { useViewport } from "./hooks.ts";

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

/** Everything the thread changed, from the host (works for threads on any machine). */
export function DiffScreen(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly toTurnCount: number;
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  const result = useAtomValue(
    props.atoms.orchestration.fullThreadDiff({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, toTurnCount: props.toTurnCount },
    }),
  );
  const { rows: height, columns } = useViewport();
  const [top, setTop] = useState(0);
  const diff = Option.getOrNull(AsyncResult.value(result))?.diff ?? null;
  const lines = useMemo(() => (diff ?? "").split("\n"), [diff]);
  const visible = Math.max(3, height - 3);
  const maxTop = Math.max(0, lines.length - visible);

  useInput(
    (input, key) => {
      if (key.escape || input === "d") return props.onBack();
      if (input === "j" || key.downArrow) setTop(Math.min(maxTop, top + 1));
      else if (input === "k" || key.upArrow) setTop(Math.max(0, top - 1));
      else if (key.pageDown || (key.ctrl && input === "f") || input === " ")
        setTop(Math.min(maxTop, top + visible - 1));
      else if (key.pageUp || (key.ctrl && input === "b")) setTop(Math.max(0, top - visible + 1));
      else if (input === "g") setTop(0);
      else if (input === "G") setTop(maxTop);
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
  if (diff.trim() === "") return h(Text, { dimColor: true }, "No changes. (esc back)");
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
      `${top + 1}-${Math.min(lines.length, top + visible)}/${lines.length} · ]/[ file · space/pgdn · esc back`,
    ),
  );
}
