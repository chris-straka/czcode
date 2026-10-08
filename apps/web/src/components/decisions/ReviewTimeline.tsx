import type { DecisionAudioMark, DecisionMediaRef } from "@cz/contracts";
import { MessageSquareIcon, XIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** A mark before it knows which media it belongs to. */
export type TimelineMark = Omit<DecisionAudioMark, "media_idx">;
export type TimelineTag = TimelineMark["tag"];

export interface TagChoice {
  readonly tag: TimelineTag;
  readonly label: string;
  readonly icon: ReactNode;
}

/** A drag shorter than this many pixels is a click (seek), not a mark. */
const DRAG_PX = 5;

const TAG_STYLE: Record<TimelineTag, { readonly band: string; readonly chip: string }> = {
  like: { band: "bg-success/20", chip: "bg-success/10" },
  keep: { band: "bg-success/20", chip: "bg-success/10" },
  cut: { band: "bg-destructive/20", chip: "bg-destructive/10" },
  change: { band: "bg-warning/25", chip: "bg-warning/15" },
  note: { band: "bg-info", chip: "bg-info/10" },
};

const TAG_WORD: Record<TimelineTag, string> = {
  like: "Like",
  keep: "Keep",
  cut: "Cut",
  change: "Change",
  note: "Comment",
};

export const clock = (seconds: number) =>
  Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

/**
 * The timeline under a sound or a video: click to seek, section labels
 * above, and with `onMarks`, drag across it to mark a stretch with one of
 * `tags` and a note, or pin a comment to the current moment. The track
 * itself (a waveform, a plain bar) comes from `track`, given how far it has
 * played.
 */
export function ReviewTimeline({
  media,
  duration,
  time,
  onSeek,
  track,
  tags,
  marks,
  onMarks,
  compact = false,
  short = false,
  leading,
  trailing,
}: {
  readonly media: DecisionMediaRef;
  readonly duration: number;
  readonly time: number;
  readonly onSeek: (seconds: number) => void;
  readonly track: (progress: number) => ReactNode;
  readonly tags: ReadonlyArray<TagChoice>;
  readonly marks: ReadonlyArray<TimelineMark>;
  readonly onMarks?: ((marks: ReadonlyArray<TimelineMark>) => void) | undefined;
  readonly compact?: boolean;
  /** A slim track (a video's timeline) that still marks and comments. */
  readonly short?: boolean;
  /** Beside the track, left and right: a play button, the time. */
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [note, setNote] = useState("");
  const drag = useRef<{ x: number; ratio: number; moved: boolean } | null>(null);

  const ratioAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const span = (start: number, end: number) =>
    duration > 0
      ? {
          left: `${(start / duration) * 100}%`,
          width: end > start ? `${((end - start) / duration) * 100}%` : "2px",
        }
      : { left: "0%", width: "0%" };
  const close = () => {
    setPending(null);
    setSelection(null);
    setNote("");
  };
  const save = (tag: TimelineTag) => {
    if (!pending || !onMarks) return;
    const trimmed = note.trim();
    if (tag === "note" && !trimmed) return;
    onMarks([...marks, { ...pending, tag, ...(trimmed ? { note: trimmed } : {}) }]);
    close();
  };
  const moment = pending !== null && pending.start === pending.end;

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3",
        compact ? "gap-y-1" : "gap-y-2",
      )}
    >
      {!compact && media.sections?.length && duration > 0 ? (
        <div className="relative col-start-2 h-4 text-2xs text-muted-foreground" aria-hidden>
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
      <div className="col-start-1 flex">{leading}</div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={onMarks ? "Timeline: click to seek, drag to mark" : "Timeline: click to seek"}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time)} of ${clock(duration)}`}
        className={cn(
          "relative w-full cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-8" : short ? "h-10" : "h-20",
        )}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") onSeek(time + 5);
          else if (event.key === "ArrowLeft") onSeek(time - 5);
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
          onSeek(ratioAt(event) * duration);
        }}
      >
        {marks.map((mark) => (
          <span
            key={`${mark.start}:${mark.end}:${mark.tag}`}
            className={cn("absolute inset-y-0 rounded-sm", TAG_STYLE[mark.tag].band)}
            style={span(mark.start, mark.end)}
          />
        ))}
        {selection ? (
          <span
            className="absolute inset-y-0 rounded-sm bg-primary/20 ring-1 ring-primary"
            style={span(selection.start, selection.end)}
          />
        ) : null}
        {track(duration > 0 ? time / duration : 0)}
      </div>
      <div className="col-start-3 flex">{trailing}</div>

      {pending && onMarks ? (
        <div className="col-span-3 flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {moment
              ? `At ${clock(pending.start)}`
              : `${clock(pending.start)}–${clock(pending.end)}`}
          </span>
          <Input
            size="sm"
            className="min-w-40 flex-1"
            placeholder={moment ? "Comment" : "Note (optional)"}
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              save(
                moment
                  ? "note"
                  : (tags.find((choice) => choice.tag === "change")?.tag ?? tags[0]!.tag),
              );
            }}
          />
          {moment ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!note.trim()}
              onClick={() => save("note")}
            >
              <MessageSquareIcon />
              Comment
            </Button>
          ) : (
            tags.map((choice) => (
              <Button key={choice.tag} size="xs" variant="outline" onClick={() => save(choice.tag)}>
                {choice.icon}
                {choice.label}
              </Button>
            ))
          )}
          <Button size="xs" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      ) : null}

      {onMarks && !compact ? (
        <div className="col-span-3 flex flex-wrap items-center gap-1.5">
          {marks.map((mark, index) => (
            <span
              key={`${mark.start}:${mark.end}:${mark.tag}`}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
                TAG_STYLE[mark.tag].chip,
              )}
            >
              <button
                type="button"
                className="tabular-nums hover:underline"
                onClick={() => onSeek(mark.start)}
              >
                {TAG_WORD[mark.tag]}{" "}
                {mark.start === mark.end
                  ? clock(mark.start)
                  : `${clock(mark.start)}–${clock(mark.end)}`}
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
            </span>
          ))}
          <Button
            size="xs"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => setPending({ start: time, end: time })}
          >
            <MessageSquareIcon />
            Comment at {clock(time)}
          </Button>
          {marks.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              or drag across the timeline to mark a part.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
