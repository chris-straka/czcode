import type { DecisionMediaRef, EnvironmentId } from "@cz/contracts";
import { Box, Text } from "ink";
import { createElement as h, useEffect, useState } from "react";

import { inlineImagesSupported } from "../model/kitty.ts";
import { pngFor, posterFrame, turntableFrame } from "../model/media.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { InlineImage, LETTERBOX } from "./InlineImage.ts";
import { useMediaFile } from "./useMedia.ts";

const SIZE = (bytes: number) =>
  bytes > 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} kB`;

/**
 * One media file of a decision: images and 3D turntable frames inline, the
 * rest as a labelled line whose action keys the screen lists.
 */
export function MediaView(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly media: DecisionMediaRef;
  readonly maxColumns: number;
  readonly maxRows: number;
  /** Turntable frame and clay view, for models. */
  readonly frame: number;
  readonly clay: boolean;
  readonly playing: boolean;
  readonly onPath?: (path: string | null) => void;
  /** Fill a fixed maxColumns × maxRows frame (option tiles line up). */
  readonly framed?: boolean;
}) {
  const { path, error } = useMediaFile(props.atoms, props.environmentId, props.media);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const kind = props.media.type;

  useEffect(() => props.onPath?.(path), [path]);
  // What draws inline: the image itself, a turntable frame, or a video's poster.
  const drawn = kind === "image" || kind === "glb" || kind === "video";
  useEffect(() => {
    setPng(null);
    setRenderError(null);
    if (path === null || !drawn) return;
    let live = true;
    const load =
      kind === "image"
        ? pngFor(path)
        : kind === "video"
          ? posterFrame(path).then(pngFor)
          : turntableFrame(path, props.frame, props.clay).then((frame) => pngFor(frame));
    load
      .then((bytes) => live && setPng(bytes))
      .catch((cause: unknown) => live && setRenderError(String(cause)));
    return () => {
      live = false;
    };
  }, [path, kind, props.frame, props.clay]);
  const sourceKey =
    kind === "glb" ? `${path}#${props.frame}${props.clay ? "c" : ""}` : `${path}#${kind}`;

  const caption = props.media.caption ? ` — ${props.media.caption}` : "";
  // Anything that isn't drawn as an image still fills the frame in a tile.
  const tile = (text: string, style: Record<string, unknown> = {}) =>
    props.framed
      ? h(
          Box,
          {
            width: props.maxColumns,
            height: props.maxRows,
            flexShrink: 0,
            backgroundColor: LETTERBOX,
            alignItems: "center",
            justifyContent: "center",
          },
          h(Text, { wrap: "truncate", ...style }, text),
        )
      : h(Text, style, text);
  if (error) return tile(`${props.media.name}: ${error}`, { color: "red" });
  if (renderError) return tile(`${props.media.name}: ${renderError}`, { color: "red" });
  switch (kind) {
    case "image":
    case "glb":
      return h(InlineImage, {
        png,
        sourceKey,
        label: `${props.media.name}${kind === "glb" ? ` ${props.frame * 30}°${props.clay ? " clay" : ""}` : ""}`,
        maxColumns: props.maxColumns,
        maxRows: props.maxRows,
        ...(props.framed ? { framed: true } : {}),
      });
    case "audio":
    case "voice":
      return tile(
        `${props.playing ? "▶" : "♪"} ${props.media.name}${props.framed ? "" : caption}`,
        props.playing ? { color: "green" } : {},
      );
    case "video":
      // The poster frame where the terminal draws images, with the play action under it.
      if (inlineImagesSupported()) {
        const rows = Math.max(2, props.maxRows - 1);
        return h(
          Box,
          { flexDirection: "column", flexShrink: 0 },
          h(InlineImage, {
            png,
            sourceKey,
            label: props.media.name,
            maxColumns: props.maxColumns,
            maxRows: rows,
            ...(props.framed ? { framed: true } : {}),
          }),
          h(
            Text,
            { wrap: "truncate", ...(props.playing ? { color: "green" } : {}) },
            `${props.playing ? "▶" : "🎞"} ${props.media.name}${props.framed ? "" : caption} · o play`,
          ),
        );
      }
      return tile(`🎞 ${props.media.name}${props.framed ? "" : caption} · o play`);
    case "apk":
      return tile(`⬇ ${props.media.name} · ${SIZE(props.media.size)}`);
    default:
      return tile(
        `▤ ${props.media.name} · ${SIZE(props.media.size)}${props.framed ? "" : caption}`,
      );
  }
}
