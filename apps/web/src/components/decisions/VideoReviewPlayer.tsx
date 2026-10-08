import type { DecisionMediaRef } from "@cz/contracts";
import { PencilIcon, ScissorsIcon, ThumbsUpIcon } from "lucide-react";
import { useRef, useState } from "react";

import { CueSheet } from "./CueSheet";
import { clock, ReviewTimeline, type TagChoice, type TimelineMark } from "./ReviewTimeline";
import { claimPlayback } from "./WaveformPlayer";

const VIDEO_TAGS: ReadonlyArray<TagChoice> = [
  { tag: "keep", label: "Keep", icon: <ThumbsUpIcon /> },
  { tag: "cut", label: "Cut", icon: <ScissorsIcon /> },
  { tag: "change", label: "Change this", icon: <PencilIcon /> },
];

/**
 * A video to review: the player, and under it a timeline to drag across to
 * mark a stretch as keep, cut, or change (with a note), or to pin a comment
 * to the moment on screen. Marks go back to the agent with the answer.
 */
export function VideoReviewPlayer({
  url,
  media,
  marks,
  onMarks,
}: {
  readonly url: string;
  readonly media: DecisionMediaRef;
  readonly marks: ReadonlyArray<TimelineMark>;
  readonly onMarks: (marks: ReadonlyArray<TimelineMark>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = Math.min(duration, Math.max(0, seconds));
    setTime(video.currentTime);
  };
  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={url}
        className="max-h-[50vh] w-full rounded-md bg-black"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onPlay={(event) => claimPlayback(event.currentTarget)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
      />
      <ReviewTimeline
        media={media}
        duration={duration}
        time={time}
        onSeek={seek}
        tags={VIDEO_TAGS}
        marks={marks}
        onMarks={onMarks}
        short
        trailing={
          <span className="text-xs tabular-nums text-muted-foreground">
            {clock(time)} / {clock(duration)}
          </span>
        }
        track={(progress) => (
          <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      />
      {media.cues?.length ? <CueSheet cues={media.cues} time={time} onSeek={seek} /> : null}
    </div>
  );
}
