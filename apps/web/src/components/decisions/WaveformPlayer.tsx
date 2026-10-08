import type { DecisionMediaRef } from "@cz/contracts";
import { PauseIcon, PencilIcon, PlayIcon, ThumbsUpIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../ui/button";
import { clock, ReviewTimeline, type TagChoice, type TimelineMark } from "./ReviewTimeline";

const NO_MARKS: ReadonlyArray<TimelineMark> = [];
const BARS = 180;
const COMPACT_BARS = 72;
const SOUND_TAGS: ReadonlyArray<TagChoice> = [
  { tag: "like", label: "Like", icon: <ThumbsUpIcon /> },
  { tag: "change", label: "Change this", icon: <PencilIcon /> },
];

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

/** Only one sound or video plays at a time. */
let playing: HTMLMediaElement | null = null;

/** Pauses whatever else is playing when `element` starts. */
export function claimPlayback(element: HTMLMediaElement) {
  if (playing && playing !== element) playing.pause();
  playing = element;
}

/**
 * A sound as its waveform, SoundCloud style: one play button, the played
 * part coloured, click anywhere to seek, section labels above. With
 * `onMarks`, dragging across it marks a stretch to like or change, and a
 * comment can be pinned to a moment.
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
  readonly marks?: ReadonlyArray<TimelineMark>;
  readonly onMarks?: (marks: ReadonlyArray<TimelineMark>) => void;
  readonly onEngage?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipId = useId();
  const bars = compact ? COMPACT_BARS : BARS;
  const [peaks, setPeaks] = useState<ReadonlyArray<number> | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);

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
      claimPlayback(audio);
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
  const shown = peaks ?? Array.from({ length: bars }, () => 0.08);

  return (
    <div className="flex flex-col gap-2">
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
      <ReviewTimeline
        media={media}
        duration={duration}
        time={time}
        onSeek={seek}
        tags={SOUND_TAGS}
        marks={marks}
        onMarks={onMarks}
        compact={compact}
        leading={
          <Button
            size={compact ? "icon-sm" : "icon"}
            variant="default"
            aria-label={paused ? `Play ${media.caption ?? media.name}` : "Pause"}
            onClick={toggle}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
        }
        trailing={
          <span className="text-xs tabular-nums text-muted-foreground">
            {clock(time)} / {clock(duration)}
          </span>
        }
        track={(progress) => (
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
        )}
      />
    </div>
  );
}
