import { Box, Text } from "ink";
import { createElement as h, useState } from "react";

import { useViewport } from "./hooks.ts";
import { useKeys } from "./input.ts";

export interface PickerChoice<T> {
  readonly label: string;
  /** Dim text after the label (a time, a provider, "current"). */
  readonly detail?: string;
  readonly value: T;
}

/**
 * A list to choose one entry from, for snooze times, models, and projects.
 * Typing filters, ↑/↓ (or ctrl+p/n) move, Enter picks, Esc cancels. j/k move
 * too until something is typed, so short lists keep vim keys.
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
  const [cursor, setCursor] = useState(props.initialIndex ?? 0);
  const { rows: height } = useViewport();
  const needle = query.toLowerCase();
  const shown = props.choices.filter((choice) =>
    `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(needle),
  );
  const selected = Math.min(cursor, Math.max(0, shown.length - 1));
  const visible = Math.max(3, height - 6);
  const top = Math.max(0, Math.min(selected - Math.floor(visible / 2), shown.length - visible));

  useKeys(
    (input, key) => {
      if (key.escape) return props.onCancel();
      if (key.return) {
        const choice = shown[selected];
        if (choice) props.onPick(choice.value);
        return;
      }
      const vim = query === "";
      if (key.downArrow || (key.ctrl && input === "n") || (vim && input === "j"))
        return setCursor(Math.min(shown.length - 1, selected + 1));
      if (key.upArrow || (key.ctrl && input === "p") || (vim && input === "k"))
        return setCursor(Math.max(0, selected - 1));
      if (key.backspace || key.delete) {
        setQuery(query.slice(0, -1));
        return setCursor(0);
      }
      if (key.ctrl || key.tab || !input) return;
      setQuery(query + input);
      setCursor(0);
    },
    { isActive: props.active },
  );

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, props.title, query ? h(Text, { color: "cyan" }, `  /${query}`) : null),
    shown.length === 0
      ? h(Text, { dimColor: true }, "Nothing matches.")
      : shown.slice(top, top + visible).map((choice, offset) => {
          const isSelected = top + offset === selected;
          return h(
            Box,
            { key: `${top + offset}:${choice.label}` },
            h(Text, { color: "cyan" }, isSelected ? "› " : "  "),
            h(Text, { bold: isSelected, wrap: "truncate" }, choice.label),
            choice.detail ? h(Text, { dimColor: true, wrap: "truncate" }, `  ${choice.detail}`) : null,
          );
        }),
    h(Text, { dimColor: true }, "type to filter · enter pick · esc cancel"),
  );
}
