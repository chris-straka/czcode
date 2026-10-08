import { playingCue } from "@cz/client-runtime/decisions/draft";
import type { DecisionCue } from "@cz/contracts";

import { cn } from "~/lib/utils";
import { clock } from "./ReviewTimeline";

/**
 * A piece of music as rows: when each part starts, its name, what plays,
 * how intense, and whether it loops. Clicking a row plays from there; the
 * playing row is highlighted.
 */
export function CueSheet({
  cues,
  time,
  onSeek,
  compact = false,
}: {
  readonly cues: ReadonlyArray<DecisionCue>;
  readonly time: number;
  readonly onSeek: (seconds: number) => void;
  readonly compact?: boolean;
}) {
  const playing = playingCue(cues, time);
  const columns = "grid grid-cols-[2.75rem_minmax(4rem,7rem)_minmax(0,1fr)_minmax(3rem,5rem)_2.5rem] gap-x-3";
  return (
    <div role="table" aria-label="Cue sheet" className={cn("text-xs", compact && "text-2xs")}>
      <div role="row" className={cn(columns, "px-2 pb-1 text-muted-foreground")}>
        <span role="columnheader">Time</span>
        <span role="columnheader">Part</span>
        <span role="columnheader">What plays</span>
        <span role="columnheader">Intensity</span>
        <span role="columnheader">Loops</span>
      </div>
      {cues.map((cue, index) => (
        <button
          key={`${cue.at}:${cue.section}`}
          type="button"
          role="row"
          aria-current={index === playing ? "true" : undefined}
          onClick={() => onSeek(cue.at)}
          className={cn(
            columns,
            "w-full rounded-md px-2 py-1 text-start hover:bg-accent/50",
            index === playing && "bg-accent text-accent-foreground",
          )}
        >
          <span role="cell" className="tabular-nums">
            {clock(cue.at)}
          </span>
          <span role="cell" className="font-medium">
            {cue.section}
          </span>
          <span role="cell">{cue.plays}</span>
          <span role="cell">{cue.intensity ?? ""}</span>
          <span role="cell">{cue.loop === undefined ? "" : cue.loop ? "Yes" : "No"}</span>
        </button>
      ))}
    </div>
  );
}
