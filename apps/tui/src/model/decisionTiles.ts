/**
 * Option tiles in a decision: every option gets the same 4:3 frame, its image
 * contained and centred on a neutral letterbox, and an option without an
 * image gets a text tile the same size. Pure, for the layout tests.
 *
 * @module decisionTiles
 */

const GAP = 1;
const MIN_TILE_COLUMNS = 22;
const MAX_TILE_COLUMNS = 40;
/** Terminal cells are about twice as tall as wide, so 4:3 is 3/4 × columns / 2 rows. */
const FRAME_ROWS_PER_COLUMN = 3 / 4 / 2;

export interface TileGrid {
  readonly perRow: number;
  /** Inside the tile's border: where the image (or text) goes. */
  readonly frameColumns: number;
  readonly frameRows: number;
  /** Border, frame, and the label line under it. */
  readonly tileColumns: number;
  readonly tileRows: number;
}

/** As many equal tiles per row as fit `width`, none narrower than a readable minimum. */
export function tileGrid(width: number, count: number): TileGrid {
  const fit = Math.floor((width + GAP) / (MIN_TILE_COLUMNS + GAP));
  const perRow = Math.max(1, Math.min(Math.max(1, count), fit));
  const tileColumns = Math.min(MAX_TILE_COLUMNS, Math.floor((width - GAP * (perRow - 1)) / perRow));
  const frameColumns = Math.max(4, tileColumns - 2);
  const frameRows = Math.max(3, Math.round(frameColumns * FRAME_ROWS_PER_COLUMN));
  return { perRow, frameColumns, frameRows, tileColumns, tileRows: frameRows + 3 };
}

/** Offsets that centre `image` cells inside the frame (the rest is letterbox). */
export function letterbox(
  image: { readonly columns: number; readonly rows: number },
  frame: { readonly frameColumns: number; readonly frameRows: number },
): { readonly left: number; readonly top: number } {
  return {
    left: Math.max(0, Math.floor((frame.frameColumns - image.columns) / 2)),
    top: Math.max(0, Math.floor((frame.frameRows - image.rows) / 2)),
  };
}
