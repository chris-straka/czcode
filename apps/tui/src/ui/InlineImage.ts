import { Box, Text, useStdout } from "ink";
import { createElement as h, useEffect, useState } from "react";

import {
  deleteSequence,
  fitCells,
  inlineImagesSupported,
  placeholderRows,
  pngSize,
  transmitSequence,
} from "../model/kitty.ts";

let nextImageId = 0x00c0de;

/**
 * Draws a PNG inline with Kitty placeholders, sized to fit. Falls back to a
 * one-line label where the terminal can't draw images (or inside tmux).
 */
export function InlineImage(props: {
  readonly png: Uint8Array | null;
  readonly label: string;
  readonly maxColumns: number;
  readonly maxRows: number;
}) {
  const { stdout } = useStdout();
  const [id] = useState(() => (nextImageId += 1));
  const supported = inlineImagesSupported();
  const size = props.png ? pngSize(props.png) : null;
  const cells = size ? fitCells(size, props.maxColumns, props.maxRows) : null;

  useEffect(() => {
    if (!supported || !props.png || !cells) return;
    stdout.write(transmitSequence(id, props.png, cells.columns, cells.rows));
    return () => {
      stdout.write(deleteSequence(id));
    };
  }, [supported, props.png, cells?.columns, cells?.rows, id, stdout]);

  if (!props.png) return h(Text, { dimColor: true }, `[${props.label}: loading…]`);
  if (!supported || !cells) return h(Text, { dimColor: true }, `[image: ${props.label}]`);
  const [r, g, b] = [(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff];
  // Raw SGR, not Ink's colour prop: chalk may downsample to 256 colours and lose the id.
  const open = `\u001b[38;2;${r};${g};${b}m`;
  return h(
    Box,
    { flexDirection: "column", flexShrink: 0 },
    placeholderRows(cells.columns, cells.rows).map((row, index) =>
      h(Text, { key: index, wrap: "truncate" }, `${open}${row}\u001b[39m`),
    ),
  );
}
