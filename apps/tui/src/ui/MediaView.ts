import type { DecisionMediaRef, EnvironmentId } from "@cz/contracts";
import { Text } from "ink";
import { createElement as h, useEffect, useState } from "react";

import { pngFor, turntableFrame } from "../model/media.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { InlineImage } from "./InlineImage.ts";
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
}) {
  const { path, error } = useMediaFile(props.atoms, props.environmentId, props.media);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const kind = props.media.type;

  useEffect(() => props.onPath?.(path), [path]);
  useEffect(() => {
    setPng(null);
    setRenderError(null);
    if (path === null || (kind !== "image" && kind !== "glb")) return;
    let live = true;
    const load =
      kind === "image"
        ? pngFor(path)
        : turntableFrame(path, props.frame, props.clay).then((frame) => pngFor(frame));
    load
      .then((bytes) => live && setPng(bytes))
      .catch((cause: unknown) => live && setRenderError(String(cause)));
    return () => {
      live = false;
    };
  }, [path, kind, props.frame, props.clay]);

  const caption = props.media.caption ? ` — ${props.media.caption}` : "";
  if (error) return h(Text, { color: "red" }, `${props.media.name}: ${error}`);
  if (renderError) return h(Text, { color: "red" }, `${props.media.name}: ${renderError}`);
  switch (kind) {
    case "image":
    case "glb":
      return h(InlineImage, {
        png,
        label: `${props.media.name}${kind === "glb" ? ` ${props.frame * 30}°${props.clay ? " clay" : ""}` : ""}`,
        maxColumns: props.maxColumns,
        maxRows: props.maxRows,
      });
    case "audio":
    case "voice":
      return h(
        Text,
        props.playing ? { color: "green" } : {},
        `${props.playing ? "▶" : "♪"} ${props.media.name}${caption}`,
      );
    case "video":
      return h(Text, null, `🎞 ${props.media.name}${caption}`);
    case "apk":
      return h(Text, null, `⬇ ${props.media.name} · ${SIZE(props.media.size)}`);
    default:
      return h(Text, null, `▤ ${props.media.name} · ${SIZE(props.media.size)}${caption}`);
  }
}
