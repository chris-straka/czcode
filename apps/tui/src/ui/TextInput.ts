import { Text, useInput } from "ink";
import { createElement as h } from "react";

export interface TextInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly placeholder?: string;
  readonly active: boolean;
  /** Alt+Enter (or Ctrl+J) adds a newline instead of submitting. */
  readonly multiline?: boolean;
}

/** A one-field editor: type, Backspace, Ctrl+U clears, Enter submits. */
export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  active,
  multiline,
}: TextInputProps) {
  useInput(
    (input, key) => {
      if (key.return) {
        if (multiline && key.meta) onChange(`${value}\n`);
        else onSubmit(value);
        return;
      }
      if (multiline && key.ctrl && input === "j") return onChange(`${value}\n`);
      if (key.ctrl && input === "u") return onChange("");
      if (key.backspace || key.delete) return onChange(value.slice(0, -1));
      if (key.escape || key.tab || key.upArrow || key.downArrow || key.ctrl || key.meta) return;
      if (input) onChange(value + input);
    },
    { isActive: active },
  );
  if (value === "" && placeholder) {
    return h(Text, { dimColor: true }, active ? `${placeholder}█` : placeholder);
  }
  return h(Text, null, active ? `${value}█` : value);
}
