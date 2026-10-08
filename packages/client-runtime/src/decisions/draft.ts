import type {
  DecisionAnswerInput,
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

/** The answer to send. `retry` is "none of these, try again" and needs only the note. */
export function draftToAnswer(
  item: DecisionItem,
  draft: DecisionDraft,
  retry = false,
): DecisionAnswerInput {
  const comment = draft.comment.trim() || null;
  const base = {
    choice: null as string | null,
    option_ids: null as readonly string[] | null,
    rank: null as readonly string[] | null,
    comment,
    voice_key: draft.voiceKey,
  };
  if (retry) return { ...base, retry: true };
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
  if (answer.retry) return "None of these: try again";
  const label = (id: string) => item.options.find((option) => option.id === id)?.label ?? id;
  if (answer.option_ids?.length) return answer.option_ids.map(label).join(", ");
  if (answer.rank?.length) return answer.rank.map(label).join(" › ");
  if (answer.reactions?.length) {
    const kept = answer.reactions.filter((reaction) => reaction.verdict !== "kill").length;
    return `${kept} kept, ${answer.reactions.length - kept} killed`;
  }
  if (answer.uploads?.length) return `${answer.uploads.length} file(s)`;
  if (answer.choice === "redo") return `Redo from ${answer.redo_from}`;
  const verdict = VERDICT_BUTTONS[item.kind]?.find((button) => button.value === answer.choice);
  return verdict?.label ?? answer.choice ?? "Answered";
}

/**
 * You can't approve what you haven't seen. Video, sound, and an app build
 * must be played, scrubbed, or installed before a verdict counts; pictures
 * and models show in place, so seeing the view is enough for them.
 */
export function mediaToEngage(item: Pick<DecisionItem, "kind" | "media">): ReadonlyArray<string> {
  if (item.kind === "pick" || item.kind === "rank" || item.kind === "request") return [];
  return item.media
    .filter((media) => media.type === "video" || media.type === "audio" || media.type === "apk")
    .map((media) => media.key);
}

/** Why verdict buttons are still off, or null once every such media was engaged. */
export function unseenMediaProblem(
  item: Pick<DecisionItem, "kind" | "media">,
  engaged: ReadonlySet<string>,
): string | null {
  const missing = item.media.filter(
    (media) => mediaToEngage(item).includes(media.key) && !engaged.has(media.key),
  );
  if (missing.length === 0) return null;
  const first = missing[0]!;
  return first.type === "apk"
    ? "Install the build first."
    : first.type === "video"
      ? "Watch the video first."
      : "Play the sound first.";
}

/**
 * A feed card answers in place only when nothing on it needs watching,
 * hearing, or installing first; otherwise it offers Open.
 */
export function canAnswerFromCard(item: Pick<DecisionItem, "kind" | "media">): boolean {
  return (
    mediaToEngage(item).length === 0 &&
    !item.media.some((media) => media.type === "image" && item.kind !== "pick")
  );
}
