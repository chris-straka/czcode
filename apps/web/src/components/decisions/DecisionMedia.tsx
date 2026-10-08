import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { DecisionMediaRef, EnvironmentId } from "@cz/contracts";
import { BoxIcon, DownloadIcon, FileIcon } from "lucide-react";
import { createContext, createElement, useContext, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { usePreparedConnection } from "~/state/session";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

/**
 * Told when the owner plays, scrubs, or installs a media item, so a decision
 * can hold its verdict until they have (see `unseenMediaProblem`).
 */
export const DecisionMediaEngagement = createContext<(key: string) => void>(() => {});

/** Resolves any of a host's decision media to a loadable URL. */
export function useDecisionMediaResolver(
  environmentId: EnvironmentId,
): (media: DecisionMediaRef | null | undefined) => string | null {
  const connection = usePreparedConnection(environmentId);
  return (media) =>
    media?.url && connection._tag === "Some"
      ? resolveAssetUrl(connection.value.httpBaseUrl, media.url)
      : null;
}

/** The media's signed URL, resolved against the host it lives on. */
export function useDecisionMediaUrl(
  environmentId: EnvironmentId,
  media: DecisionMediaRef | null | undefined,
): string | null {
  const connection = usePreparedConnection(environmentId);
  if (!media?.url || connection._tag !== "Some") return null;
  return resolveAssetUrl(connection.value.httpBaseUrl, media.url);
}

interface ModelViewerElement extends HTMLElement {
  availableAnimations: string[];
  animationName: string;
  model?: {
    materials: Array<{
      pbrMetallicRoughness: {
        setBaseColorFactor: (color: [number, number, number, number]) => void;
        baseColorFactor: [number, number, number, number];
        baseColorTexture: { texture: unknown; setTexture: (texture: unknown) => void } | null;
      };
    }>;
  };
  getDimensions: () => { x: number; y: number; z: number };
  play: () => void;
}

/**
 * A 3D model with orbit, its animations, a textured/clay toggle, and its size
 * (the Look view). `<model-viewer>` loads only when a model is shown.
 */
function ModelView({ src, className }: { src: string; className?: string }) {
  const ref = useRef<ModelViewerElement | null>(null);
  const [ready, setReady] = useState(false);
  const [animations, setAnimations] = useState<string[]>([]);
  const [animation, setAnimation] = useState<string | null>(null);
  const [look, setLook] = useState<"textured" | "clay">("textured");
  const [size, setSize] = useState<string | null>(null);
  const originals = useRef<Array<{ color: [number, number, number, number]; texture: unknown }>>(
    [],
  );

  useEffect(() => {
    void import("@google/model-viewer").then(() => setReady(true));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const onLoad = () => {
      setAnimations([...element.availableAnimations]);
      const { x, y, z } = element.getDimensions();
      setSize(`${x.toFixed(2)} × ${y.toFixed(2)} × ${z.toFixed(2)} m`);
      originals.current =
        element.model?.materials.map((material) => ({
          color: material.pbrMetallicRoughness.baseColorFactor,
          texture: material.pbrMetallicRoughness.baseColorTexture?.texture ?? null,
        })) ?? [];
    };
    element.addEventListener("load", onLoad);
    return () => element.removeEventListener("load", onLoad);
  }, [ready, src]);

  useEffect(() => {
    const element = ref.current;
    if (!element?.model) return;
    element.model.materials.forEach((material, index) => {
      const original = originals.current[index];
      const pbr = material.pbrMetallicRoughness;
      if (look === "clay") {
        pbr.baseColorTexture?.setTexture(null);
        pbr.setBaseColorFactor([0.72, 0.7, 0.68, 1]);
      } else if (original) {
        pbr.baseColorTexture?.setTexture(original.texture);
        pbr.setBaseColorFactor(original.color);
      }
    });
  }, [look]);

  useEffect(() => {
    const element = ref.current;
    if (!element || animation === null) return;
    element.animationName = animation;
    element.play();
  }, [animation]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {ready ? (
        createElement("model-viewer", {
          ref,
          src,
          "camera-controls": true,
          "touch-action": "pan-y",
          "shadow-intensity": "1",
          "interaction-prompt": "none",
          style: { width: "100%", height: "100%", minHeight: 320, background: "transparent" },
        })
      ) : (
        <div className="flex min-h-80 items-center justify-center text-muted-foreground">
          <BoxIcon className="size-6" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ToggleGroup
          value={[look]}
          onValueChange={(value) => setLook((value[0] as "textured" | "clay") ?? "textured")}
        >
          <Toggle size="sm" value="textured">
            Textured
          </Toggle>
          <Toggle size="sm" value="clay">
            Clay
          </Toggle>
        </ToggleGroup>
        {animations.map((name) => (
          <Button
            key={name}
            size="xs"
            variant={animation === name ? "secondary" : "ghost"}
            onClick={() => setAnimation(name)}
          >
            {name}
          </Button>
        ))}
        {size ? <span>{size}</span> : null}
      </div>
    </div>
  );
}

/**
 * The one frame every option's media shares, so options of different shapes
 * (a 2:1 floor plan next to a 16:9 render) line up: fixed aspect, contained,
 * on a neutral letterbox.
 */
export const DECISION_OPTION_FRAME_CLASS =
  "aspect-[4/3] w-full overflow-hidden rounded-md bg-muted/60";

/**
 * One media attachment, sized for a card (`compact`), an option tile
 * (`framed`), or the full view.
 */
export function DecisionMedia({
  environmentId,
  media,
  compact = false,
  framed = false,
  className,
}: {
  environmentId: EnvironmentId;
  media: DecisionMediaRef;
  compact?: boolean;
  framed?: boolean;
  className?: string;
}) {
  const url = useDecisionMediaUrl(environmentId, media);
  const engage = useContext(DecisionMediaEngagement);
  if (url === null) {
    return (
      <div
        className={cn(
          "rounded-md bg-muted",
          framed ? DECISION_OPTION_FRAME_CLASS : compact ? "h-20" : "h-48",
          className,
        )}
      />
    );
  }
  if (framed && (media.type === "image" || media.type === "video" || media.type === "glb")) {
    return (
      <div
        className={cn(DECISION_OPTION_FRAME_CLASS, "flex items-center justify-center", className)}
      >
        {media.type === "image" ? (
          <img
            alt={media.caption ?? media.name}
            src={url}
            loading="lazy"
            className="size-full object-contain"
          />
        ) : media.type === "video" ? (
          <video
            controls
            preload="metadata"
            src={url}
            onPlay={() => engage(media.key)}
            onTimeUpdate={(event) => {
              // Scrubbing moves the playhead; a load can report a seek without one.
              if (event.currentTarget.currentTime > 0.5) engage(media.key);
            }}
            className="size-full object-contain"
          />
        ) : (
          <BoxIcon className="size-6 text-muted-foreground" />
        )}
      </div>
    );
  }
  switch (media.type) {
    case "image":
      return (
        <img
          alt={media.caption ?? media.name}
          src={url}
          loading="lazy"
          className={cn(
            "w-full rounded-md bg-muted object-contain",
            compact ? "h-24 object-cover" : "max-h-[70vh]",
            className,
          )}
        />
      );
    case "audio":
    case "voice":
      return (
        <audio
          controls
          preload="none"
          src={url}
          onPlay={() => engage(media.key)}
          onTimeUpdate={(event) => {
            // Scrubbing moves the playhead; a load can report a seek without one.
            if (event.currentTarget.currentTime > 0.5) engage(media.key);
          }}
          className={cn("w-full", className)}
        />
      );
    case "video":
      return (
        <video
          controls
          preload="metadata"
          src={url}
          onPlay={() => engage(media.key)}
          onTimeUpdate={(event) => {
            // Scrubbing moves the playhead; a load can report a seek without one.
            if (event.currentTarget.currentTime > 0.5) engage(media.key);
          }}
          className={cn("w-full rounded-md bg-black", compact ? "h-24" : "max-h-[70vh]", className)}
        />
      );
    case "glb":
      return compact ? (
        <div className={cn("flex h-24 items-center justify-center rounded-md bg-muted", className)}>
          <BoxIcon className="size-6 text-muted-foreground" />
        </div>
      ) : (
        <ModelView src={url} className={cn("h-[60vh]", className)} />
      );
    case "apk":
      return (
        <Button
          render={<a href={url} download={media.name} />}
          onClick={() => engage(media.key)}
          className={className}
        >
          <DownloadIcon />
          Install {media.name}
        </Button>
      );
    default:
      return (
        <Button
          variant="outline"
          render={<a href={url} download={media.name} />}
          className={className}
        >
          <FileIcon />
          {media.name}
        </Button>
      );
  }
}
