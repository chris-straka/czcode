import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  MessageId,
  RuntimeMode,
  type ThreadId,
} from "@cz/contracts";
import * as Option from "effect/Option";
import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo, useState } from "react";
import { randomUUID } from "node:crypto";

import { hasActiveRun, type LineTone, transcriptLines } from "../model/transcript.ts";
import { wrapText } from "../model/wrap.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { useCommand } from "./command.ts";
import { useViewport } from "./hooks.ts";
import { TextInput } from "./TextInput.ts";

const TONE: Record<
  LineTone,
  { readonly color?: string; readonly dimColor?: boolean; readonly bold?: boolean }
> = {
  user: { color: "cyan", bold: true },
  assistant: {},
  tool: { dimColor: true },
  dim: { dimColor: true },
  warn: { color: "yellow" },
  error: { color: "red" },
};

/**
 * One thread, live: the transcript tail, what it's waiting on, and a reply
 * line. `i` types a reply, `y`/`a`/`n` answer an approval, digits pick an
 * answer to a question, `s` stops the run, PgUp/PgDn (or ctrl+b/f) scroll.
 */
export function ThreadScreen(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  const { atoms } = props;
  const ref = { environmentId: props.environmentId, threadId: props.threadId };
  // Subscribing to the state atom is what keeps the thread live.
  const stateResult = useAtomValue(atoms.threads.stateAtom(props.environmentId, props.threadId));
  const thread = useAtomValue(atoms.threadDetails.threadAtom(ref));
  const pending = useAtomValue(atoms.threadDetails.pendingRequestsAtom(ref));
  const { rows: height, columns } = useViewport();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scroll, setScroll] = useState(0);
  const startTurn = useCommand(atoms.threadEnvironment.startTurn);
  const interrupt = useCommand(atoms.threadEnvironment.interruptTurn);
  const setRuntimeMode = useCommand(atoms.threadEnvironment.setRuntimeMode);
  const respondToApproval = useCommand(atoms.threadEnvironment.respondToApproval);
  const respondToUserInput = useCommand(atoms.threadEnvironment.respondToUserInput);

  const projection = thread?.projection ?? null;
  const running = projection !== null && hasActiveRun(projection);
  const approval = pending?.approvals[0] ?? null;
  const question = pending?.userInputs[0] ?? null;
  const width = Math.max(20, columns - 2);
  const rows = useMemo(() => {
    const out: Array<{ key: string; tone: LineTone; text: string }> = [];
    for (const line of transcriptLines(projection?.visibleTurnItems ?? [])) {
      wrapText(line.text, width).forEach((text, index) =>
        out.push({ key: `${line.key}:${index}`, tone: line.tone, text }),
      );
    }
    return out;
  }, [projection?.visibleTurnItems, width]);

  const footer =
    (approval ? 2 : 0) + (question ? 2 + (question.questions[0]?.options.length ?? 0) : 0) + 3;
  const visible = Math.max(3, height - footer - 3);
  const maxScroll = Math.max(0, rows.length - visible);
  const offset = Math.min(scroll, maxScroll);
  const shown = rows.slice(rows.length - visible - offset, rows.length - offset);

  const reply = (text: string) => {
    if (!projection || text.trim() === "") return;
    setDraft("");
    setComposing(false);
    void startTurn({
      environmentId: props.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        threadId: props.threadId,
        message: { messageId: MessageId.make(randomUUID()), role: "user", text, attachments: [] },
        runtimeMode: projection.thread.runtimeMode,
        interactionMode: projection.thread.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: new Date().toISOString(),
      },
    });
  };

  useInput(
    (input, key) => {
      if (key.escape) return props.onBack();
      if (input === "i" || input === "r") return setComposing(true);
      if (key.pageUp || (key.ctrl && input === "b"))
        return setScroll(Math.min(maxScroll, offset + visible - 1));
      if (key.pageDown || (key.ctrl && input === "f"))
        return setScroll(Math.max(0, offset - visible + 1));
      if (input === "k" || key.upArrow) return setScroll(Math.min(maxScroll, offset + 1));
      if (input === "j" || key.downArrow) return setScroll(Math.max(0, offset - 1));
      if (input === "G") return setScroll(0);
      if (input === "m" && projection) {
        const modes = RuntimeMode.literals;
        const next = modes[(modes.indexOf(projection.thread.runtimeMode) + 1) % modes.length];
        if (next) {
          void setRuntimeMode({
            environmentId: props.environmentId,
            input: { threadId: props.threadId, runtimeMode: next },
          });
        }
        return;
      }
      if (input === "s" && running) {
        void interrupt({ environmentId: props.environmentId, input: { threadId: props.threadId } });
        return;
      }
      if (approval && (input === "y" || input === "a" || input === "n")) {
        void respondToApproval({
          environmentId: props.environmentId,
          input: {
            threadId: props.threadId,
            requestId: approval.requestId,
            decision: input === "y" ? "accept" : input === "a" ? "acceptForSession" : "decline",
          },
        });
        return;
      }
      const first = question?.questions[0];
      const choice = Number(input) - 1;
      if (question && first && Number.isInteger(choice) && first.options[choice]) {
        const option = first.options[choice];
        // One-question prompts answer on the digit; longer ones go to the reply line.
        if (question.questions.length === 1) {
          void respondToUserInput({
            environmentId: props.environmentId,
            input: {
              threadId: props.threadId,
              requestId: question.requestId,
              answers: {
                [first.id]: first.multiSelect
                  ? [option.value ?? option.label]
                  : (option.value ?? option.label),
              },
            },
          });
        }
      }
    },
    { isActive: props.active && !composing },
  );
  useInput(
    (_input, key) => {
      if (key.escape) setComposing(false);
    },
    { isActive: props.active && composing },
  );

  const state = Option.getOrNull(
    stateResult._tag === "Success" ? Option.some(stateResult.value) : Option.none(),
  );
  const title = projection?.thread.title ?? "Loading…";

  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      null,
      h(Text, { bold: true, wrap: "truncate" }, title),
      h(
        Text,
        { dimColor: true },
        running ? "  working" : state?.status === "empty" ? "  loading" : "",
      ),
    ),
    h(
      Box,
      { flexDirection: "column", height: visible },
      shown.map((row) => h(Text, { key: row.key, ...TONE[row.tone] }, row.text || " ")),
    ),
    approval
      ? h(
          Box,
          { flexDirection: "column", marginTop: 1 },
          h(
            Text,
            { color: "yellow", wrap: "truncate" },
            `Approve ${approval.requestKind}${approval.detail ? `: ${approval.detail}` : ""}?`,
          ),
          h(Text, { dimColor: true }, "y yes · a yes for this session · n no"),
        )
      : null,
    question && question.questions[0]
      ? h(
          Box,
          { flexDirection: "column", marginTop: 1 },
          h(Text, { color: "yellow" }, question.questions[0].question),
          ...question.questions[0].options.map((option, index) =>
            h(Text, { key: option.label }, `  ${index + 1}. ${option.label}`),
          ),
          h(
            Text,
            { dimColor: true },
            question.questions.length === 1
              ? "digit answers · i to type an answer"
              : "i to answer in the reply",
          ),
        )
      : null,
    h(
      Box,
      { marginTop: 1 },
      composing
        ? h(TextInput, {
            value: draft,
            active: props.active,
            multiline: true,
            placeholder: "Reply…",
            onChange: setDraft,
            onSubmit: reply,
          })
        : h(
            Text,
            { dimColor: true },
            `i reply${running ? " · s stop" : ""} · m ${projection?.thread.runtimeMode ?? "mode"} · pgup/pgdn${offset > 0 ? ` (${offset} up, G end)` : ""} · esc back`,
          ),
    ),
  );
}
