/**
 * Hard-wraps text to a column width so the transcript can be windowed by row
 * count (Ink wraps on its own, but then rows can't be counted).
 *
 * @module wrap
 */

/** Terminal cells for one code point: 2 for wide (CJK, most emoji), 0 for combining marks. */
export function cellWidth(codePoint: number): number {
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

/** Splits on newlines, then breaks each line at spaces (or mid-word when one word is too long). */
/** Prose (messages, decision text) wraps here even in a wide window: long lines are hard to read. */
export const READING_WIDTH = 70;

export function wrapText(text: string, width: number): Array<string> {
  const max = Math.max(1, width);
  const rows: Array<string> = [];
  for (const line of text.split("\n")) {
    let row = "";
    let used = 0;
    for (const word of line.split(/(\s+)/)) {
      const chars = [...word];
      const wordWidth = chars.reduce((sum, char) => sum + cellWidth(char.codePointAt(0) ?? 0), 0);
      if (used + wordWidth <= max) {
        row += word;
        used += wordWidth;
        continue;
      }
      if (/^\s+$/.test(word)) {
        rows.push(row.trimEnd());
        row = "";
        used = 0;
        continue;
      }
      if (used > 0) {
        rows.push(row.trimEnd());
        row = "";
        used = 0;
      }
      for (const char of chars) {
        const w = cellWidth(char.codePointAt(0) ?? 0);
        if (used + w > max) {
          rows.push(row);
          row = "";
          used = 0;
        }
        row += char;
        used += w;
      }
    }
    rows.push(row.trimEnd());
  }
  return rows;
}
