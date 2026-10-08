import { useEffect, useRef } from "react";

/**
 * Keys that act on the thread row or project card under the pointer (or
 * the focused one, for j/k users), like ccez-llm's hovered-message keys.
 * Listed on Settings > Keybindings via `pageKeys.ts`.
 */
export type HoverKeyAction = "open" | "archive" | "delete" | "stop";

export interface HoverKeyFacts {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  /** Typing in an input, textarea, select, or editable text. */
  readonly inField: boolean;
  /** Focus sits on a button or link, which owns Enter. */
  readonly inInteractive: boolean;
  /** A live text selection: the keys yield to it. */
  readonly hasSelection: boolean;
  /** A row or card is hovered or focused. */
  readonly hasTarget: boolean;
}

/** What this keypress does to the hovered row or card, or null to leave it alone. */
export function hoverKeyAction(facts: HoverKeyFacts): HoverKeyAction | null {
  if (!facts.hasTarget || facts.inField || facts.hasSelection) return null;
  if (facts.metaKey || facts.ctrlKey || facts.altKey) return null;
  // Physical code, so any layout's D works; Shift is required, so a bare d never deletes.
  if (facts.code === "KeyD" && facts.shiftKey) return facts.repeat ? null : "delete";
  if (facts.shiftKey) return null;
  if (facts.key === "o" || (facts.key === "Enter" && !facts.inInteractive)) return "open";
  if (facts.repeat) return null;
  if (facts.key === "e") return "archive";
  if (facts.key === "s") return "stop";
  return null;
}

/** Marks an element as a hover-key target; the value names it to `onAction`. */
export const HOVER_TARGET_ATTRIBUTE = "data-hover-target";

function hoveredTarget(): string | null {
  const hovered = document.querySelectorAll(`[${HOVER_TARGET_ATTRIBUTE}]:hover`);
  const element =
    hovered.length > 0
      ? hovered[hovered.length - 1]
      : document.activeElement?.closest(`[${HOVER_TARGET_ATTRIBUTE}]`);
  return element?.getAttribute(HOVER_TARGET_ATTRIBUTE) ?? null;
}

function isField(element: Element | null): boolean {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
}

/** Runs `onAction` for hover keys over `[data-hover-target]` elements while `enabled`. */
export function useHoverKeys(
  onAction: (action: HoverKeyAction, target: string) => void,
  enabled: boolean,
) {
  const latest = useRef(onAction);
  useEffect(() => {
    latest.current = onAction;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = hoveredTarget();
      const focused = document.activeElement;
      const action = hoverKeyAction({
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        repeat: event.repeat,
        inField: isField(event.target as Element | null) || isField(focused),
        inInteractive: focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement,
        hasSelection: (window.getSelection()?.toString() ?? "") !== "",
        hasTarget: target !== null,
      });
      if (!action || target === null) return;
      event.preventDefault();
      latest.current(action, target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
