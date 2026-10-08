import { Box, Text } from "ink";
import { createElement as h, useState } from "react";

import { useViewport } from "./hooks.ts";
import { useKeys, useVimMotion } from "./input.ts";

export interface PickerChoice<T> {
  readonly label: string;
  /** Dim text after the label (a time, a provider, "current"). */
  readonly detail?: string;
  readonly value: T;
}

/**
 * A list to choose one entry from, for snooze times, models, and projects.
 * Vim keys move and q/h/Esc cancel; `/` types a filter (↑/↓ or ctrl+p/n move
 * while filtering); Enter picks.
 */
export function Picker<T>(props: {
  readonly title: string;
  readonly choices: ReadonlyArray<PickerChoice<T>>;
  readonly active: boolean;
  readonly initialIndex?: number;
  readonly onPick: (value: T) => void;
  readonly onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  // `/` types a filter, as in vim; otherwise keys move (j/k, gg/G) and q/h cancel.
  const [filtering, setFiltering] = useState(false);
  const [cursor, setCursor] = useState(props.initialIndex ?? 0);
  const { rows: height } = useViewport();
  const needle = query.toLowerCase();
  const shown = props.choices.filter((choice) =>
    `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(needle),
  );
  const selected = Math.min(cursor, Math.max(0, shown.length - 1));
  const visible = Math.max(3, height - 6);
  const top = Math.max(0, Math.min(selected - Math.floor(visible / 2), shown.length - visible));

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (key.return) {
        const choice = shown[selected];
        if (choice) props.onPick(choice.value);
        return;
      }
      if (filtering) {
        if (key.escape) return setFiltering(false);
        if (key.downArrow || (key.ctrl && input === "n"))
          return setCursor(Math.min(shown.length - 1, selected + 1));
        if (key.upArrow || (key.ctrl && input === "p")) return setCursor(Math.max(0, selected - 1));
        if (key.backspace || key.delete) {
          setQuery(query.slice(0, -1));
          return setCursor(0);
        }
        if (key.ctrl || key.tab || !input) return;
        setQuery(query + input);
        return setCursor(0);
      }
      if (key.escape) return props.onCancel();
      if (input === "/") return setFiltering(true);
      vim(input, key, {
        cursor: selected,
        count: shown.length,
        page: visible,
        onMove: setCursor,
        onBack: props.onCancel,
      });
    },
    { isActive: props.active },
  );

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Text,
      { bold: true },
      props.title,
      query || filtering ? h(Text, { color: "cyan" }, `  /${query}${filtering ? "█" : ""}`) : null,
    ),
    shown.length === 0
      ? h(Text, { dimColor: true }, "Nothing matches.")
      : shown.slice(top, top + visible).map((choice, offset) => {
          const isSelected = top + offset === selected;
          return h(
            Box,
            { key: `${top + offset}:${choice.label}` },
            h(Text, { color: "cyan" }, isSelected ? "› " : "  "),
            h(Text, { bold: isSelected, wrap: "truncate" }, choice.label),
            choice.detail
              ? h(Text, { dimColor: true, wrap: "truncate" }, `  ${choice.detail}`)
              : null,
          );
        }),
    h(
      Text,
      { dimColor: true },
      filtering
        ? "type to filter · enter pick · esc stop filtering"
        : "/ filter · enter pick · q back",
    ),
  );
}
