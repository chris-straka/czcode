/**
 * Draft edits the TUI's keys make, on client-runtime's shared DecisionDraft
 * (whose `draftProblem`/`draftToAnswer` decide what can be sent).
 *
 * @module decisionDraft
 */
import type { DecisionDraft } from "@cz/client-runtime/decisions/draft";
import type { DecisionItem, DecisionReaction } from "@cz/contracts";

/** Space on an option: toggles it, or replaces the pick when only one is allowed. */
export function togglePick(
  item: DecisionItem,
  draft: DecisionDraft,
  optionId: string,
): DecisionDraft {
  if (draft.optionIds.includes(optionId)) {
    return { ...draft, optionIds: draft.optionIds.filter((id) => id !== optionId) };
  }
  if (item.max_choices <= 1) return { ...draft, optionIds: [optionId] };
  if (draft.optionIds.length >= item.max_choices) return draft;
  return { ...draft, optionIds: [...draft.optionIds, optionId] };
}

/** Moves the ranked option at `index` up (-1) or down (+1); returns the new index. */
export function moveRank(
  draft: DecisionDraft,
  index: number,
  delta: -1 | 1,
): { readonly draft: DecisionDraft; readonly index: number } {
  const target = index + delta;
  if (target < 0 || target >= draft.rank.length) return { draft, index };
  const rank = [...draft.rank];
  [rank[index], rank[target]] = [rank[target]!, rank[index]!];
  return { draft: { ...draft, rank }, index: target };
}

/** Keep/kill/favourite one sound; the same verdict again clears it. */
export function react(
  draft: DecisionDraft,
  optionId: string,
  verdict: NonNullable<DecisionReaction["verdict"]>,
): DecisionDraft {
  const current = draft.reactions[optionId];
  const next: DecisionReaction = {
    option_id: optionId,
    verdict: current?.verdict === verdict ? null : verdict,
    ...(current?.note ? { note: current.note } : {}),
  };
  return { ...draft, reactions: { ...draft.reactions, [optionId]: next } };
}

/** A comment on one paragraph of a Read item's text (its character range and quote). */
export function addPassageComment(
  draft: DecisionDraft,
  body: string,
  paragraph: number,
  note: string,
): DecisionDraft {
  const ranges = paragraphRanges(body);
  const range = ranges[paragraph];
  if (!range || note.trim() === "") return draft;
  return {
    ...draft,
    passageComments: [
      ...draft.passageComments,
      {
        start: range.start,
        end: range.end,
        quote: body.slice(range.start, range.end),
        note: note.trim(),
      },
    ],
  };
}

/** Character ranges of the non-empty paragraphs (blank-line separated) of a text. */
export function paragraphRanges(
  body: string,
): Array<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  for (const match of body.matchAll(pattern)) {
    if (match[0].trim() !== "")
      ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}
