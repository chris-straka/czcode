/**
 * Vim motions shared by every list and scroll view: j/k, gg/G, ctrl-d/u
 * (half page), ctrl-f/b and PgDn/PgUp (page), and q or h for back. Pure, so
 * the bindings are testable; `useVim` holds the pending `g`.
 *
 * @module vim
 */
import type { Key } from "ink";

export type VimAction =
  | { readonly kind: "move"; readonly cursor: number }
  | { readonly kind: "back" }
  | { readonly kind: "pending" };

export interface VimContext {
  readonly cursor: number;
  /** Number of positions; the cursor stays in [0, count - 1]. */
  readonly count: number;
  /** Rows on screen, for page and half-page moves. */
  readonly page: number;
  /** The previous key was a lone `g`. */
  readonly pendingG: boolean;
  /** `h` goes back here (off where h means something else, like a 3D turntable). */
  readonly backOnH?: boolean;
}

/** What a key does, or null when it isn't a vim motion (the screen handles it). */
export function vimMotion(input: string, key: Key, context: VimContext): VimAction | null {
  const last = Math.max(0, context.count - 1);
  const to = (cursor: number): VimAction => ({
    kind: "move",
    cursor: Math.min(last, Math.max(0, cursor)),
  });
  const half = Math.max(1, Math.floor(context.page / 2));
  const page = Math.max(1, context.page - 1);
  if (input === "g" && !key.ctrl) return context.pendingG ? to(0) : { kind: "pending" };
  if (key.ctrl && input === "d") return to(context.cursor + half);
  if (key.ctrl && input === "u") return to(context.cursor - half);
  if (key.pageDown || (key.ctrl && input === "f")) return to(context.cursor + page);
  if (key.pageUp || (key.ctrl && input === "b")) return to(context.cursor - page);
  if (key.ctrl || key.meta) return null;
  if (input === "j" || key.downArrow) return to(context.cursor + 1);
  if (input === "k" || key.upArrow) return to(context.cursor - 1);
  if (input === "G") return to(last);
  if (input === "q" || (input === "h" && (context.backOnH ?? true))) return { kind: "back" };
  return null;
}
