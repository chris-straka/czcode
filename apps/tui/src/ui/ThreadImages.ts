/**
 * Images attached to a thread's messages, drawn inline in the transcript.
 * Each image is a block of placeholder rows, one transcript line per row, so
 * it scrolls and clips with the text. A loader per image on screen fetches it
 * once (signed URL, local cache, PNG), hands it to the terminal image store,
 * and reports its id and size; rows off screen cost nothing.
 *
 * @module ThreadImages
 */
import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Text } from "ink";
import { createElement as h, useEffect, useState } from "react";

import { fitCells, placeholderRows, pngSize } from "../model/kitty.ts";
import { cachedMedia, pngFor } from "../model/media.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { terminalImages } from "./InlineImage.ts";

/** Rows an attached image takes in the transcript (it's contained in them). */
export const THREAD_IMAGE_ROWS = 12;
export const THREAD_IMAGE_COLUMNS = 56;

export interface ThreadImage {
  readonly id: number;
  readonly columns: number;
  readonly rows: number;
  /** Placeholder text per row, built once. */
  readonly lines: ReadonlyArray<string>;
}

/** Fetches one attachment and registers it with the terminal; renders nothing. */
export function ThreadImageLoader(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
  readonly maxColumns: number;
  readonly onReady: (attachmentId: string, image: ThreadImage | null) => void;
}) {
  const { atoms, environmentId, attachmentId, onReady } = props;
  const prepared = useAtomValue(atoms.session.preparedConnectionValueAtom(environmentId));
  const base = Option.getOrNull(prepared)?.httpBaseUrl ?? null;
  const signed = useAtomValue(
    atoms.assets.createUrl({
      environmentId,
      input: { resource: { _tag: "attachment", attachmentId } },
    }),
  );
  const relativeUrl = Option.getOrNull(AsyncResult.value(signed))?.relativeUrl ?? null;
  const [png, setPng] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (relativeUrl === null || base === null) return;
    const url = resolveAssetUrl(base, relativeUrl);
    if (url === null) return;
    let live = true;
    cachedMedia(`attachment:${attachmentId}`, url)
      .then(pngFor)
      .then(
        (bytes) => live && setPng(bytes),
        () => live && onReady(attachmentId, null),
      );
    return () => {
      live = false;
    };
  }, [attachmentId, relativeUrl, base]);

  const size = png ? pngSize(png) : null;
  const cells = size ? fitCells(size, props.maxColumns, THREAD_IMAGE_ROWS) : null;
  useEffect(() => {
    if (!png || !cells) return;
    const key = `attachment:${attachmentId}@${cells.columns}x${cells.rows}`;
    const id = terminalImages.acquire(key, { png, ...cells });
    onReady(attachmentId, { id, ...cells, lines: placeholderRows(cells.columns, cells.rows) });
    return () => terminalImages.release(key);
  }, [png, cells?.columns, cells?.rows]);
  return null;
}

/** One transcript row of an image: its placeholder cells, or a label while it loads. */
export function ThreadImageRow(props: {
  readonly image: ThreadImage | null | undefined;
  readonly row: number;
  readonly name: string;
}) {
  const { image, row } = props;
  if (!image) {
    return row === 0
      ? h(
          Text,
          { dimColor: true },
          `🖼 ${props.name}${image === null ? " (couldn't load)" : " · loading…"}`,
        )
      : h(Text, null, " ");
  }
  const line = image.lines[row];
  if (line === undefined) return h(Text, null, " ");
  const [r, g, b] = [(image.id >> 16) & 0xff, (image.id >> 8) & 0xff, image.id & 0xff];
  // Raw SGR, not Ink's colour prop: chalk may downsample to 256 colours and lose the id.
  return h(Text, { wrap: "truncate" }, `\u001b[38;2;${r};${g};${b}m${line}\u001b[39m`);
}
