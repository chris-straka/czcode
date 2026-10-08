import { useEffect, useRef } from "react";

/** The second g of "gg" must follow the first within this long (ccez-llm uses 800). */
const GG_WINDOW_MS = 800;

/**
 * The same motions as ccez-llm: a line (j/k), a skip of three lines (d/u), a
 * half page (Ctrl+D/U), and the ends (gg/G). `open` and `back` are l and h.
 */
export interface VimKeyHandlers {
  readonly move: (direction: 1 | -1, size: "line" | "skip" | "half") => void;
  readonly top: () => void;
  readonly bottom: () => void;
  readonly open?: () => void;
  readonly back?: () => void;
}

type VimMotion = readonly [1 | -1, "line" | "skip" | "half"] | "g" | "bottom" | "open" | "back";

/** The motion a key press asks for, before gg timing; null for any other key. */
export function vimMotion(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey">,
): VimMotion | null {
  if (event.ctrlKey) {
    if (event.shiftKey) return null;
    const key = event.key.toLowerCase();
    return key === "d" ? [1, "half"] : key === "u" ? [-1, "half"] : null;
  }
  switch (event.key) {
    case "j":
      return [1, "line"];
    case "k":
      return [-1, "line"];
    case "d":
      return [1, "skip"];
    case "u":
      return [-1, "skip"];
    case "g":
      return "g";
    case "G":
      return "bottom";
    case "l":
      return "open";
    case "h":
      return "back";
    default:
      return null;
  }
}

export function typingTarget(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * Vim motions while `enabled`. Keys typed into a field, with Meta/Alt (or Ctrl
 * other than Ctrl+D/U), or already handled (defaultPrevented) are left alone.
 */
export function useVimKeys(handlers: VimKeyHandlers, enabled = true) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    let lastG = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.altKey) return;
      if (typingTarget(event.target)) return;
      const keys = latest.current;
      const motion = vimMotion(event);
      if (motion === null) return;
      if (motion === "g") {
        const now = event.timeStamp;
        if (now - lastG >= GG_WINDOW_MS) {
          lastG = now;
          return;
        }
        lastG = 0;
        keys.top();
      } else if (motion === "bottom") keys.bottom();
      else if (motion === "open") {
        if (!keys.open) return;
        keys.open();
      } else if (motion === "back") {
        if (!keys.back) return;
        keys.back();
      } else keys.move(motion[0], motion[1]);
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** Pixels per motion when scrolling an open view, matching ccez-llm's 72px line. */
export function vimScrollDistance(size: "line" | "skip" | "half", scroller: HTMLElement): number {
  return size === "line"
    ? 72
    : size === "skip"
      ? 216
      : Math.max(1, Math.floor(scroller.clientHeight / 2));
}

/** The element a full view scrolls: its tallest scrollable descendant. */
export function mainScroller(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  let best: HTMLElement | null = null;
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (element.scrollHeight <= element.clientHeight + 4) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (!best || element.clientHeight > best.clientHeight) best = element;
  }
  return best;
}
