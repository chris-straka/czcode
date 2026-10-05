/**
 * Keyboard and mouse input for every screen. Screens call `useKeys` instead of
 * Ink's `useInput`, which hands them Alt combos as plain letters (Alt+Q would
 * quit) and SGR mouse reports as text (a text field would type them in).
 *
 * The App turns on mouse reporting and routes reports through `useMouseRouter`:
 * the wheel reaches the active screen as ↑/↓, and a click reaches whichever
 * `useClick` box it landed in.
 *
 * @module input
 */
import { type DOMElement, type Key, useApp, useInput, useStdin, useStdout } from "ink";
import { type RefObject, useEffect, useRef } from "react";

export interface MouseEvent {
  readonly kind: "wheel-up" | "wheel-down" | "click";
  /** Zero-based cell column and row from the top left of the screen. */
  readonly x: number;
  readonly y: number;
}

// ESC [ < button ; column ; row (M press, m release). Ink strips the ESC.
const MOUSE_REPORT = /\u001b?\[<(\d+);(\d+);(\d+)([Mm])/g;

/** The mouse events in one input chunk, or null when it isn't a mouse report. */
export function parseMouse(input: string): MouseEvent[] | null {
  const matches = [...input.matchAll(MOUSE_REPORT)];
  if (matches.length === 0) return null;
  const events: MouseEvent[] = [];
  for (const [, button, column, row, action] of matches) {
    const code = Number(button);
    const x = Number(column) - 1;
    const y = Number(row) - 1;
    if (code === 64) events.push({ kind: "wheel-up", x, y });
    else if (code === 65) events.push({ kind: "wheel-down", x, y });
    // A left press with no modifiers; releases and drags are ignored.
    else if (code === 0 && action === "M") events.push({ kind: "click", x, y });
  }
  return events;
}

const listeners = new Set<(event: MouseEvent) => void>();

const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

/**
 * Ink's `useInput`, minus mouse reports and Alt/Cmd combos (unless
 * `allowMeta`, for Alt+Enter in a text field), plus the wheel as ↑/↓.
 */
export function useKeys(
  handler: (input: string, key: Key) => void,
  options: { readonly isActive: boolean; readonly allowMeta?: boolean },
) {
  const latest = useRef(handler);
  latest.current = handler;
  useInput(
    (input, key) => {
      if (parseMouse(input) !== null) return;
      if ((key.meta || key.super) && !key.escape && !options.allowMeta) return;
      latest.current(input, key);
    },
    { isActive: options.isActive },
  );
  useEffect(() => {
    if (!options.isActive) return;
    const onMouse = (event: MouseEvent) => {
      if (event.kind === "wheel-up") latest.current("", { ...NO_KEY, upArrow: true });
      if (event.kind === "wheel-down") latest.current("", { ...NO_KEY, downArrow: true });
    };
    listeners.add(onMouse);
    return () => {
      listeners.delete(onMouse);
    };
  }, [options.isActive]);
}

/** Where a box sits on screen, from Yoga's layout (positions are parent-relative). */
function screenRect(element: DOMElement) {
  let left = 0;
  let top = 0;
  for (let node: DOMElement | undefined = element; node; node = node.parentNode) {
    left += node.yogaNode?.getComputedLeft() ?? 0;
    top += node.yogaNode?.getComputedTop() ?? 0;
  }
  return {
    left,
    top,
    width: element.yogaNode?.getComputedWidth() ?? 0,
    height: element.yogaNode?.getComputedHeight() ?? 0,
  };
}

/** Calls `onClick` with the cell inside `ref`'s box that was clicked. */
export function useClick(
  ref: RefObject<DOMElement | null>,
  onClick: (cell: { readonly column: number; readonly row: number }) => void,
  isActive: boolean,
) {
  const latest = useRef(onClick);
  latest.current = onClick;
  useEffect(() => {
    if (!isActive) return;
    const onMouse = (event: MouseEvent) => {
      if (event.kind !== "click" || !ref.current) return;
      const rect = screenRect(ref.current);
      const column = event.x - rect.left;
      const row = event.y - rect.top;
      if (column >= 0 && row >= 0 && column < rect.width && row < rect.height) {
        latest.current({ column, row });
      }
    };
    listeners.add(onMouse);
    return () => {
      listeners.delete(onMouse);
    };
  }, [isActive, ref]);
}

/**
 * Turns on mouse reporting for the session and hands each report to the
 * screens. Mount once, at the root. Reads stdin alongside Ink, which drops
 * the reports as unknown sequences. Also quits on the chunk `exit` + Enter,
 * which the owner's Alt+X ("exit the focused terminal") types.
 */
export function useMouseRouter() {
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const { exit } = useApp();
  useEffect(() => {
    // 1000 reports presses, releases, and the wheel; 1006 encodes them as SGR.
    stdout.write("\u001b[?1000h\u001b[?1006h");
    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      if (text === "exit\n" || text === "exit\r") return exit();
      for (const event of parseMouse(text) ?? []) {
        for (const listener of [...listeners]) listener(event);
      }
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      stdout.write("\u001b[?1006l\u001b[?1000l");
    };
  }, [stdin, stdout, exit]);
}
