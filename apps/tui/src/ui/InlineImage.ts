import { Box, Text } from "ink";
import { createElement as h, useEffect, useState } from "react";

import {
  deleteSequence,
  fitCells,
  inlineImagesSupported,
  placeholderRows,
  pngSize,
  transmitSequence,
} from "../model/kitty.ts";
import { letterbox } from "../model/decisionTiles.ts";
import { makeImageStore } from "../model/imageStore.ts";

/** The neutral surround of a framed image or a text-only tile. */
export const LETTERBOX = "#1c1c22";

// Image ids share one store per terminal, so two `ct` floats in one Ghostty
// window start from ids spread by process id. The id is also the placeholder's
// 24-bit colour, so it stays below 0x1000000.
export const terminalImages = makeImageStore({
  write: (sequence) => process.stdout.write(sequence),
  transmit: transmitSequence,
  remove: deleteSequence,
  firstId: 0x100000 + ((process.pid * 40_503) % 0xe00000),
});

/**
 * Draws a PNG inline with Kitty placeholders, sized to fit. Falls back to a
 * one-line label where the terminal can't draw images (or inside tmux).
 */
export function InlineImage(props: {
  readonly png: Uint8Array | null;
  /** Names the picture (a file path, plus frame for a turntable): same key, same terminal image. */
  readonly sourceKey: string;
  readonly label: string;
  readonly maxColumns: number;
  readonly maxRows: number;
  /**
   * Draw into a fixed frame of maxColumns × maxRows: the image contained and
   * centred on a neutral letterbox, so sibling tiles line up.
   */
  readonly framed?: boolean;
}) {
  const supported = inlineImagesSupported();
  const size = props.png ? pngSize(props.png) : null;
  const cells = size ? fitCells(size, props.maxColumns, props.maxRows) : null;
  const storeKey = cells ? `${props.sourceKey}@${cells.columns}x${cells.rows}` : null;
  const [id, setId] = useState<number | null>(null);

  // Sent once per picture and size; repaints and remounts reuse the terminal's copy.
  useEffect(() => {
    if (!supported || !props.png || !cells || storeKey === null) return;
    setId(terminalImages.acquire(storeKey, { png: props.png, ...cells }));
    return () => terminalImages.release(storeKey);
  }, [supported, storeKey]);

  const fallback = !props.png
    ? `${props.label}: loading…`
    : !supported || !cells
      ? `image: ${props.label}`
      : null;
  const frame = { frameColumns: props.maxColumns, frameRows: props.maxRows };
  const inFrame = (child: ReturnType<typeof h>, offset = { left: 0, top: 0 }) =>
    h(
      Box,
      {
        width: props.maxColumns,
        height: props.maxRows,
        flexShrink: 0,
        backgroundColor: LETTERBOX,
        paddingLeft: offset.left,
        paddingTop: offset.top,
        ...(fallback ? { alignItems: "center", justifyContent: "center" } : {}),
      },
      child,
    );
  if (fallback !== null || !cells || id === null) {
    const text = h(
      Text,
      { dimColor: true, wrap: "truncate" },
      props.framed ? fallback : `[${fallback}]`,
    );
    return props.framed ? inFrame(text) : text;
  }
  const [r, g, b] = [(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff];
  // Raw SGR, not Ink's colour prop: chalk may downsample to 256 colours and lose the id.
  const open = `\u001b[38;2;${r};${g};${b}m`;
  const image = h(
    Box,
    { flexDirection: "column", flexShrink: 0 },
    placeholderRows(cells.columns, cells.rows).map((row, index) =>
      h(Text, { key: index, wrap: "truncate" }, `${open}${row}\u001b[39m`),
    ),
  );
  return props.framed ? inFrame(image, letterbox(cells, frame)) : image;
}
