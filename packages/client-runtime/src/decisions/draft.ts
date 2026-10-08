import type {
  DecisionAnswerInput,
  DecisionAudioMark,
  DecisionCue,
  DecisionItem,
  DecisionMediaRef,
  DecisionPassageComment,
  DecisionPlaytestForm,
  DecisionReaction,
  DecisionRedline,
} from "@cz/contracts";

/** What the owner has filled in so far for one decision. */
export interface DecisionDraft {
  readonly choice: string | null;
  readonly optionIds: readonly string[];
  readonly rank: readonly string[];
  readonly reactions: Readonly<Record<string, DecisionReaction>>;
  readonly moreLikeThese: boolean;
  readonly redlines: readonly DecisionRedline[];
  /** Stretches marked on audio waveforms (review, listen). */
  readonly marks: readonly DecisionAudioMark[];
  readonly passageComments: readonly DecisionPassageComment[];
  readonly playtest: DecisionPlaytestForm;
  readonly uploads: readonly DecisionMediaRef[];
  readonly redoFrom: string | null;
  readonly comment: string;
  readonly voiceKey: string | null;
}

export function emptyDraft(item: DecisionItem): DecisionDraft {
  return {
    choice: null,
    optionIds: [],
    rank: item.options.map((option) => option.id),
    reactions: {},
    moreLikeThese: false,
    redlines: [],
    marks: [],
    passageComments: [],
    playtest: { good: "", bad: "", bugs: "" },
    uploads: [],
    redoFrom: null,
    comment: "",
    voiceKey: null,
  };
}

/** Verdict buttons for kinds answered with one word. */
export const VERDICT_BUTTONS: Partial<
  Record<DecisionItem["kind"], ReadonlyArray<{ readonly value: string; readonly label: string }>>
> = {
  review: [
    { value: "approve", label: "Approve" },
    { value: "changes", label: "Ask for changes" },
    { value: "reject", label: "Reject" },
  ],
  look: [
    { value: "approve", label: "Approve" },
    { value: "changes", label: "Ask for changes" },
    { value: "reject", label: "Reject" },
  ],
  read: [
    { value: "approve", label: "Approve" },
    { value: "send_back", label: "Send back" },
  ],
  pitch: [
    { value: "yes", label: "Yes" },
    { value: "later", label: "Later" },
    { value: "never", label: "Never" },
  ],
};

const hasNote = (draft: DecisionDraft) =>
  draft.comment.trim().length > 0 || draft.voiceKey !== null;

/** Why the draft can't be sent yet, or null when it can. Mirrors the server's checks. */
export function draftProblem(item: DecisionItem, draft: DecisionDraft): string | null {
  switch (item.kind) {
    case "pick":
      if (draft.optionIds.length === 0) return "Pick an option.";
      return draft.optionIds.length > item.max_choices ? `Pick at most ${item.max_choices}.` : null;
    case "rank":
      return draft.rank.length === item.options.length ? null : "Rank every option.";
    case "listen":
      return Object.values(draft.reactions).some((reaction) => reaction.verdict !== null) ||
        draft.moreLikeThese ||
        hasNote(draft)
        ? null
        : "Keep, kill, or favourite at least one sound.";
    case "request":
      return draft.uploads.length > 0 || hasNote(draft)
        ? null
        : "Add a file, text, or a voice note.";
    case "playtest":
      return Object.values(draft.playtest).some((value) => value.trim()) || hasNote(draft)
        ? null
        : "Say what felt good or bad.";
    case "timeline":
      if (draft.choice === "redo" && draft.redoFrom === null) return "Pick the step to redo from.";
      return draft.choice === null ? "Approve the run or redo from a step." : null;
    default:
      return draft.choice === null ? "Choose an answer." : null;
  }
}

/** The selection after clicking an option: a selected option clears, others join (or replace). */
export function toggleOptionId(
  item: DecisionItem,
  optionIds: ReadonlyArray<string>,
  id: string,
): ReadonlyArray<string> {
  if (optionIds.includes(id)) return optionIds.filter((value) => value !== id);
  return item.max_choices === 1 ? [id] : [...optionIds, id];
}

/**
 * The answer to send. `noneOfThese` is "none of these": it carries only the
 * note and asks the agent for new options.
 */
export function draftToAnswer(
  item: DecisionItem,
  draft: DecisionDraft,
  noneOfThese?: boolean,
): DecisionAnswerInput {
  const comment = draft.comment.trim() || null;
  const base = {
    choice: null as string | null,
    option_ids: null as readonly string[] | null,
    rank: null as readonly string[] | null,
    comment,
    voice_key: draft.voiceKey,
    // Stretches and comments marked on a sound's or video's timeline, whatever the kind.
    ...(draft.marks.length > 0 ? { marks: draft.marks } : {}),
    // Pictures attached to the note (a Request's files), whatever the kind.
    ...(draft.uploads.length > 0 ? { uploads: draft.uploads } : {}),
  };
  if (noneOfThese) return { ...base, retry: true };
  switch (item.kind) {
    case "pick":
      return { ...base, option_ids: draft.optionIds };
    case "rank":
      return { ...base, rank: draft.rank };
    case "listen":
      return {
        ...base,
        reactions: Object.values(draft.reactions).filter(
          (reaction) => reaction.verdict !== null || reaction.note,
        ),
        more_like_these: draft.moreLikeThese,
      };
    case "request":
      return { ...base, uploads: draft.uploads };
    case "playtest":
      return { ...base, playtest: draft.playtest };
    case "timeline":
      return { ...base, choice: draft.choice, redo_from: draft.redoFrom };
    case "review":
      return { ...base, choice: draft.choice, redlines: draft.redlines };
    case "read":
      return { ...base, choice: draft.choice, passage_comments: draft.passageComments };
    default:
      return { ...base, choice: draft.choice };
  }
}

/** A one-line summary of an answer for the answered card. */
export function answerSummary(item: DecisionItem, answer: DecisionAnswerInput): string {
  if (answer.retry) return "None of these";
  // Older clients could turn a pick down without asking for new options.
  if (answer.declined) return "None of these (no new options)";
  const label = (id: string) => item.options.find((option) => option.id === id)?.label ?? id;
  if (answer.option_ids?.length) return answer.option_ids.map(label).join(", ");
  if (answer.rank?.length) return answer.rank.map(label).join(" › ");
  if (answer.reactions?.length) {
    const kept = answer.reactions.filter((reaction) => reaction.verdict !== "kill").length;
    return `${kept} kept, ${answer.reactions.length - kept} killed`;
  }
  if (item.kind === "request" && answer.uploads?.length) {
    return `${answer.uploads.length} file(s)`;
  }
  if (answer.choice === "redo") return `Redo from ${answer.redo_from}`;
  const verdict = VERDICT_BUTTONS[item.kind]?.find((button) => button.value === answer.choice);
  const marks = answer.marks?.length ? ` · ${answer.marks.length} marked` : "";
  return `${verdict?.label ?? answer.choice ?? "Answered"}${marks}`;
}

/**
 * The picture an option shows: its own media, or none. Media several options
 * point at (one overview image on every option) or media with no file
 * belongs to no option; `contextMedia` shows it once above them instead.
 */
export function optionMedia(
  item: Pick<DecisionItem, "options" | "media">,
  option: DecisionItem["options"][number],
): DecisionMediaRef | null {
  if (option.media_idx === null) return null;
  const media = item.media[option.media_idx];
  if (!media?.url) return null;
  const sharing = item.options.filter((other) => other.media_idx === option.media_idx).length;
  return sharing === 1 ? media : null;
}

/** A pick's media that belongs to no single option, shown once above the options. */
export function contextMedia(
  item: Pick<DecisionItem, "options" | "media">,
): ReadonlyArray<DecisionMediaRef> {
  const owned = new Set(
    item.options.flatMap((option) => {
      const media = optionMedia(item, option);
      return media ? [media.key] : [];
    }),
  );
  return item.media.filter((media) => media.url && !owned.has(media.key));
}

/** The cue that's playing at `time`: the last one starting at or before it. */
export function playingCue(cues: ReadonlyArray<DecisionCue>, time: number): number {
  let playing = -1;
  cues.forEach((cue, index) => {
    if (cue.at <= time && (playing < 0 || cue.at >= cues[playing]!.at)) playing = index;
  });
  return playing;
}
