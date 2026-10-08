import { useEffect, useRef } from "react";

/** The second g of "gg" must follow the first within this long. */
const GG_WINDOW_MS = 600;

export interface VimKeyHandlers {
  readonly down: () => void;
  readonly up: () => void;
  readonly top: () => void;
  readonly bottom: () => void;
}

function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * j/k down and up, gg to the top, G to the bottom, while `enabled`. Keys typed
 * into a field, with a modifier, or already handled (defaultPrevented) are
 * left alone.
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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingTarget(event.target)) return;
      const keys = latest.current;
      if (event.key === "g") {
        const now = event.timeStamp;
        if (now - lastG < GG_WINDOW_MS) {
          lastG = 0;
          keys.top();
        } else {
          lastG = now;
          return;
        }
      } else if (event.key === "G") keys.bottom();
      else if (event.key === "j") keys.down();
      else if (event.key === "k") keys.up();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
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
