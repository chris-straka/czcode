/**
 * Inline images over the Kitty graphics protocol with Unicode placeholders:
 * the image is transmitted once (a virtual placement), then drawn by ordinary
 * text cells (U+10EEEE plus row/column diacritics, coloured with the image
 * id), so it moves, scrolls, and clips with the text — and with a neovim
 * float, whose terminal forwards the transmit to Ghostty (see the nvim hook).
 *
 * @module kitty
 */
import * as NodeChildProcess from "node:child_process";

/** Row/column diacritics from the Kitty spec (rowcolumn-diacritics.txt), first 64. */
const DIACRITICS = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658,
];
export const MAX_PLACEHOLDER_CELLS = DIACRITICS.length;
const PLACEHOLDER = String.fromCodePoint(0x10eeee);

const forwardsByNvim = new Map<string, boolean>();

/** Whether the neovim at `socket` loaded the owner's Kitty passthrough hook. Asked once. */
function nvimForwardsImages(socket: string): boolean {
  let forwards = forwardsByNvim.get(socket);
  if (forwards === undefined) {
    try {
      const answer = NodeChildProcess.execFileSync(
        "nvim",
        ["--server", socket, "--remote-expr", "exists('#KittyPassthrough#TermRequest')"],
        { timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      forwards = answer.trim() === "1";
    } catch {
      forwards = false;
    }
    forwardsByNvim.set(socket, forwards);
  }
  return forwards;
}

/**
 * Terminals that draw Kitty placeholders. Inside tmux they'd need passthrough,
 * so no. Inside neovim (which passes TERM_PROGRAM on to its terminals), only
 * when that neovim forwards the images: `nvim --clean` or one over ssh doesn't.
 */
export function inlineImagesSupported(
  env: NodeJS.ProcessEnv = process.env,
  forwardsImages: (socket: string) => boolean = nvimForwardsImages,
): boolean {
  if (env.CZ_TUI_IMAGES === "0") return false;
  if (env.CZ_TUI_IMAGES === "1") return true;
  if (env.TMUX) return false;
  const program = env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = env.TERM ?? "";
  // TERM survives ssh (TERM_PROGRAM doesn't), so Ghostty or kitty on the Mac
  // ssh'd into a host still gets images; a phone's ssh app says xterm-256color.
  const terminal =
    program === "ghostty" ||
    program === "wezterm" ||
    env.KITTY_WINDOW_ID !== undefined ||
    term.includes("kitty") ||
    term.includes("ghostty");
  const socket = env.NVIM?.trim();
  return terminal && (!socket || forwardsImages(socket));
}

/** The APC chunks that transmit a PNG as a virtual placement of `columns` x `rows` cells. */
export function transmitSequence(
  id: number,
  png: Uint8Array,
  columns: number,
  rows: number,
): string {
  const data = Buffer.from(png).toString("base64");
  const chunks: Array<string> = [];
  for (let offset = 0; offset < data.length; offset += 4096) {
    const chunk = data.slice(offset, offset + 4096);
    const more = offset + 4096 < data.length ? 1 : 0;
    const control =
      offset === 0 ? `a=T,U=1,i=${id},f=100,q=2,c=${columns},r=${rows},m=${more}` : `m=${more}`;
    chunks.push(`\u001b_G${control};${chunk}\u001b\\`);
  }
  return chunks.join("");
}

/** Deletes an image (and frees its data) when the view no longer shows it. */
export function deleteSequence(id: number): string {
  return `\u001b_Ga=d,d=I,i=${id},q=2\u001b\\`;
}

/** The placeholder text for each row, to render with foreground `idColor(id)`. */
export function placeholderRows(columns: number, rows: number): Array<string> {
  const width = Math.min(columns, MAX_PLACEHOLDER_CELLS);
  return Array.from({ length: Math.min(rows, MAX_PLACEHOLDER_CELLS) }, (_, row) => {
    let line = "";
    for (let column = 0; column < width; column++) {
      line += PLACEHOLDER + String.fromCodePoint(DIACRITICS[row]!, DIACRITICS[column]!);
    }
    return line;
  });
}

/** The image id as a 24-bit foreground colour, the way placeholders name their image. */
export function idColor(id: number): string {
  return `#${(id & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Width and height of a PNG from its header, or null for anything else. */
export function pngSize(
  png: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Cells for an image that fits `maxColumns` x `maxRows` (cells are about twice as tall as wide). */
export function fitCells(
  size: { readonly width: number; readonly height: number },
  maxColumns: number,
  maxRows: number,
): { readonly columns: number; readonly rows: number } {
  const limitColumns = Math.max(1, Math.min(maxColumns, MAX_PLACEHOLDER_CELLS));
  const limitRows = Math.max(1, Math.min(maxRows, MAX_PLACEHOLDER_CELLS));
  const aspect = size.height / Math.max(1, size.width);
  let columns = limitColumns;
  let rows = Math.round((columns * aspect) / 2);
  if (rows > limitRows) {
    rows = limitRows;
    columns = Math.max(1, Math.round((rows * 2) / aspect));
  }
  return { columns, rows: Math.max(1, rows) };
}
