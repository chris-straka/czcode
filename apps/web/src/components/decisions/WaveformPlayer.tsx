import type { DecisionAudioMark, DecisionMediaRef } from "@cz/contracts";
import { PauseIcon, PlayIcon, ThumbsUpIcon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** A mark before it knows which media it belongs to. */
export type WaveformMark = Omit<DecisionAudioMark, "media_idx">;

const NO_MARKS: ReadonlyArray<WaveformMark> = [];
const BARS = 180;
const COMPACT_BARS = 72;
/** A drag shorter than this many pixels is a click (seek), not a mark. */
const DRAG_PX = 5;

const peaksByKey = new Map<string, Promise<ReadonlyArray<number> | null>>();

/** The loudest sample in each of `count` slices, 0..1; null when the audio can't be read. */
function loadPeaks(key: string, url: string, count: number) {
  const cacheKey = `${key}\u0000${count}`;
  const cached = peaksByKey.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
      const samples = audio.getChannelData(0);
      const step = Math.max(1, Math.floor(samples.length / count));
      const peaks = Array.from({ length: count }, (_, slice) => {
        let peak = 0;
        const end = Math.min(samples.length, (slice + 1) * step);
        for (let index = slice * step; index < end; index += 16) {
          peak = Math.max(peak, Math.abs(samples[index]!));
        }
        return peak;
      });
      const loudest = Math.max(...peaks, 0.001);
      return peaks.map((peak) => peak / loudest);
    } catch {
      return null;
    }
  })();
  peaksByKey.set(cacheKey, promise);
  return promise;
}

/** Only one waveform plays at a time. */
let playing: HTMLAudioElement | null = null;

const clock = (seconds: number) =>
  Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

/**
 * A sound as its waveform, SoundCloud style: one play button, the played
 * part coloured, click anywhere to seek, section labels above. With
 * `onMarks`, dragging across it marks a stretch to like or change.
 */
export function WaveformPlayer({
  url,
  media,
  compact = false,
  marks = NO_MARKS,
  onMarks,
  onEngage,
}: {
  readonly url: string;
  readonly media: DecisionMediaRef;
  readonly compact?: boolean;
  readonly marks?: ReadonlyArray<WaveformMark>;
  readonly onMarks?: (marks: ReadonlyArray<WaveformMark>) => void;
  readonly onEngage?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipId = useId();
  const bars = compact ? COMPACT_BARS : BARS;
  const [peaks, setPeaks] = useState<ReadonlyArray<number> | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [note, setNote] = useState("");
  const drag = useRef<{ x: number; ratio: number; moved: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void loadPeaks(media.key, url, bars).then((loaded) => {
      if (live) setPeaks(loaded);
    });
    return () => {
      live = false;
    };
  }, [media.key, url, bars]);

  useEffect(
    () => () => {
      if (playing === audioRef.current) playing = null;
    },
    [],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      void audio.play();
    } else {
      audio.pause();
    }
  };
  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, seconds));
    setTime(audio.currentTime);
  };
  const ratioAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const saveMark = (tag: WaveformMark["tag"]) => {
    if (!pending || !onMarks) return;
    const trimmed = note.trim();
    onMarks([...marks, { ...pending, tag, ...(trimmed ? { note: trimmed } : {}) }]);
    setPending(null);
    setSelection(null);
    setNote("");
  };

  const progress = duration > 0 ? time / duration : 0;
  const shown = peaks ?? Array.from({ length: bars }, () => 0.08);
  const span = (start: number, end: number) =>
    duration > 0
      ? { left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }
      : { left: "0%", width: "0%" };

  return (
    <div className={cn("flex flex-col", compact ? "gap-1" : "gap-2")}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => {
          setTime(event.currentTarget.currentTime);
          // Scrubbing moves the playhead; a load can report a seek without one.
          if (event.currentTarget.currentTime > 0.5) onEngage?.();
        }}
        onPlay={() => {
          setPaused(false);
          onEngage?.();
        }}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
      />
      <div className="flex items-center gap-3">
        <Button
          size={compact ? "icon-sm" : "icon"}
          variant="default"
          aria-label={paused ? `Play ${media.caption ?? media.name}` : "Pause"}
          className="shrink-0"
          onClick={toggle}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {!compact && media.sections?.length && duration > 0 ? (
            <div className="relative h-4 text-2xs text-muted-foreground" aria-hidden>
              {media.sections.map((section) => (
                <span
                  key={`${section.at}:${section.label}`}
                  className="absolute top-0 truncate border-s border-border ps-1"
                  style={{ left: `${(section.at / duration) * 100}%`, maxWidth: "30%" }}
                >
                  {section.label}
                </span>
              ))}
            </div>
          ) : null}
          <div
            role="slider"
            tabIndex={0}
            aria-label={
              onMarks ? "Waveform: click to seek, drag to mark" : "Waveform: click to seek"
            }
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            className={cn(
              "relative w-full cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact ? "h-8" : "h-20",
            )}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") seek(time + 5);
              else if (event.key === "ArrowLeft") seek(time - 5);
              else if (event.key === " ") toggle();
              else return;
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, ratio: ratioAt(event), moved: false };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || !onMarks || duration <= 0) return;
              if (!start.moved && Math.abs(event.clientX - start.x) < DRAG_PX) return;
              start.moved = true;
              const [a, b] = [start.ratio, ratioAt(event)].sort((x, y) => x - y);
              setSelection({ start: a! * duration, end: b! * duration });
            }}
            onPointerUp={(event) => {
              const start = drag.current;
              drag.current = null;
              if (!start) return;
              if (start.moved && selection) {
                setPending(selection);
                return;
              }
              seek(ratioAt(event) * duration);
            }}
          >
            {marks.map((mark) => (
              <span
                key={`${mark.start}:${mark.end}`}
                className={cn(
                  "absolute inset-y-0 rounded-sm",
                  mark.tag === "like" ? "bg-success/20" : "bg-warning/25",
                )}
                style={span(mark.start, mark.end)}
              />
            ))}
            {selection ? (
              <span
                className="absolute inset-y-0 rounded-sm bg-primary/20 ring-1 ring-primary"
                style={span(selection.start, selection.end)}
              />
            ) : null}
            <svg
              viewBox={`0 0 ${bars} 100`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full"
              aria-hidden
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={0} y={0} width={progress * bars} height={100} />
                </clipPath>
              </defs>
              {[false, true].map((played) => (
                <g
                  key={String(played)}
                  className={played ? "fill-primary" : "fill-muted-foreground/40"}
                  {...(played ? { clipPath: `url(#${clipId})` } : {})}
                >
                  {shown.map((peak, index) => {
                    const height = Math.max(3, peak * 96);
                    return (
                      <rect
                        key={index}
                        x={index + 0.15}
                        y={50 - height / 2}
                        width={0.7}
                        height={height}
                        rx={0.3}
                      />
                    );
                  })}
                </g>
              ))}
            </svg>
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {clock(time)} / {clock(duration)}
        </span>
      </div>

      {pending && onMarks ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {clock(pending.start)}–{clock(pending.end)}
          </span>
          <Input
            size="sm"
            className="min-w-40 flex-1"
            placeholder="Note (optional)"
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveMark("change");
              }
            }}
          />
          <Button size="xs" variant="outline" onClick={() => saveMark("like")}>
            <ThumbsUpIcon />
            Like
          </Button>
          <Button size="xs" variant="outline" onClick={() => saveMark("change")}>
            <PencilIcon />
            Change this
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setPending(null);
              setSelection(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {onMarks && marks.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {marks.map((mark, index) => (
            <li
              key={`${mark.start}:${mark.end}`}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
                mark.tag === "like" ? "bg-success/10" : "bg-warning/15",
              )}
            >
              <button
                type="button"
                className="tabular-nums hover:underline"
                onClick={() => seek(mark.start)}
              >
                {mark.tag === "like" ? "Like" : "Change"} {clock(mark.start)}–{clock(mark.end)}
              </button>
              {mark.note ? <span className="text-muted-foreground">· {mark.note}</span> : null}
              <button
                type="button"
                aria-label="Remove mark"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onMarks(marks.filter((_, other) => other !== index))}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : !compact && onMarks ? (
        <p className="text-xs text-muted-foreground">
          Click to jump; drag across the waveform to mark a part you like or want changed.
        </p>
      ) : null}
    </div>
  );
}
