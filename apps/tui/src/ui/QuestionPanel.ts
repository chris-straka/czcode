import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@cz/client-runtime/pending-user-input";
import type { ThreadPendingUserInput } from "@cz/client-runtime/state/thread-requests";
import { Box, Text } from "ink";
import { createElement as h, useState } from "react";

import { useKeys } from "./input.ts";
import { TextInput } from "./TextInput.ts";

/**
 * An agent's question, answered the way the desktop composer answers it:
 * digits pick options (toggle on multi-select), `i` types an answer of your
 * own, `[`/`]` move between questions, Enter sends once each has an answer,
 * and `X` dismisses it unanswered.
 */
export function QuestionPanel(props: {
  readonly request: ThreadPendingUserInput;
  readonly active: boolean;
  readonly onAnswer: (answers: Record<string, string | string[]>) => void;
  readonly onDismiss: () => void;
  /** While typing an answer, the thread's own keys stand down. */
  readonly onTypingChange: (typing: boolean) => void;
}) {
  const { questions } = props.request;
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [index, setIndex] = useState(0);
  const [typing, setTypingState] = useState(false);
  const setTyping = (next: boolean) => {
    setTypingState(next);
    props.onTypingChange(next);
  };
  const progress = derivePendingUserInputProgress(questions, drafts, index);
  const question = progress.activeQuestion;

  const submit = (nextDrafts: Record<string, PendingUserInputDraftAnswer>) => {
    const answers = buildPendingUserInputAnswers(questions, nextDrafts);
    if (answers) props.onAnswer(answers);
  };
  /** After an answer: the next question, or send when this was the last. */
  const advance = (nextDrafts: Record<string, PendingUserInputDraftAnswer>) => {
    if (progress.isLastQuestion) submit(nextDrafts);
    else setIndex(progress.questionIndex + 1);
  };

  useKeys(
    (input, key) => {
      if (!question) return;
      if (input === "]") return setIndex(Math.min(questions.length - 1, progress.questionIndex + 1));
      if (input === "[") return setIndex(Math.max(0, progress.questionIndex - 1));
      if (input === "X") return props.onDismiss();
      if (input === "i" && question.allowCustomAnswer !== false) return setTyping(true);
      if (key.return) {
        if (progress.canAdvance) advance(drafts);
        return;
      }
      const option = question.options[Number(input) - 1];
      if (!option) return;
      const nextDrafts = {
        ...drafts,
        [question.id]: togglePendingUserInputOptionSelection(
          question,
          drafts[question.id],
          option.value ?? option.label,
        ),
      };
      setDrafts(nextDrafts);
      // One choice answers a single-select question; multi-select waits for Enter.
      if (!question.multiSelect) advance(nextDrafts);
    },
    { isActive: props.active && !typing },
  );
  useKeys(
    (_input, key) => {
      if (key.escape) setTyping(false);
    },
    { isActive: props.active && typing },
  );

  if (!question) return null;
  const selected = new Set(progress.selectedOptionValues);
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(
      Text,
      { color: "yellow", wrap: "wrap" },
      `${questions.length > 1 ? `(${progress.questionIndex + 1}/${questions.length}) ` : ""}${question.question}`,
    ),
    ...question.options.map((option, optionIndex) =>
      h(
        Text,
        { key: option.label, wrap: "truncate" },
        `  ${optionIndex + 1}. ${question.multiSelect ? (selected.has(option.value ?? option.label) ? "[x] " : "[ ] ") : selected.has(option.value ?? option.label) ? "› " : ""}${option.label}`,
        option.description ? h(Text, { dimColor: true }, ` – ${option.description}`) : null,
      ),
    ),
    typing
      ? h(TextInput, {
          value: progress.customAnswer,
          active: props.active,
          multiline: true,
          placeholder: "Your answer…",
          onChange: (text) =>
            setDrafts({
              ...drafts,
              [question.id]: setPendingUserInputCustomAnswer(drafts[question.id], text),
            }),
          onSubmit: () => {
            setTyping(false);
            if (progress.canAdvance) advance(drafts);
          },
        })
      : progress.usingCustomAnswer
        ? h(Text, { color: "cyan", wrap: "truncate" }, `  ✎ ${progress.customAnswer}`)
        : null,
    h(
      Text,
      { dimColor: true, wrap: "truncate" },
      typing
        ? "enter answers · esc back"
        : [
            question.multiSelect ? "digits toggle · enter next" : "digit answers",
            question.allowCustomAnswer !== false ? "i type an answer" : null,
            questions.length > 1 ? "[ ] questions" : null,
            "X dismiss",
          ]
            .filter(Boolean)
            .join(" · "),
    ),
  );
}
