import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { buildPlanImplementationPrompt } from "@cz/client-runtime/proposed-plan";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  MessageId,
  type ModelSelection,
  type PlanId,
  RuntimeMode,
  ThreadId,
  type UploadChatImageAttachment,
} from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Box, Text } from "ink";
import { createElement as h, useContext, useEffect, useMemo, useState } from "react";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expandPath, imageAttachment } from "../model/attachments.ts";
import { cycleEffort, hostModels, modelLabel } from "../model/hosts.ts";
import { hasActiveRun, type LineTone, transcriptLines } from "../model/transcript.ts";
import { wrapText } from "../model/wrap.ts";
import {
  floatTerminalLua,
  parentNvim,
  remoteShellCommand,
  runInParentNvim,
} from "../model/nvim.ts";
import { readClipboardImage } from "../runtime/clipboard.ts";
import { LOCAL_CONNECTION_ID } from "../runtime/platform.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { useViewport } from "./hooks.ts";
import { useKeys } from "./input.ts";
import { Picker } from "./Picker.ts";
import { QuestionPanel } from "./QuestionPanel.ts";
import { TextInput } from "./TextInput.ts";
import { useWakeHost } from "./useWakeHost.ts";

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

type Composer = "closed" | "reply" | "attach";

/**
 * One thread, live: the transcript tail, what it's waiting on, and the
 * composer. `i` writes a reply (Tab picks queue or steer while it runs),
 * `y`/`a`/`n` answer an approval, the question panel answers questions, `s`
 * stops the run. M picks the model, e its effort, p plan mode, m access.
 */
export function ThreadScreen(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly active: boolean;
  readonly onBack: () => void;
  /** Shows the thread's changes, from the latest turn. */
  readonly onDiff: (turnCount: number) => void;
  /** Opens another thread (a fork) on the same host. */
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const { atoms, environmentId, threadId } = props;
  const ref = { environmentId, threadId };
  // Subscribing to the state atom is what keeps the thread live.
  const stateResult = useAtomValue(atoms.threads.stateAtom(environmentId, threadId));
  const thread = useAtomValue(atoms.threadDetails.threadAtom(ref));
  const pending = useAtomValue(atoms.threadDetails.pendingRequestsAtom(ref));
  const queue = useAtomValue(atoms.threadDetails.queueWorkflowAtom(ref));
  const config = useAtomValue(atoms.serverConfigsAtom).get(environmentId) ?? null;
  const { rows: height, columns } = useViewport();
  const [composer, setComposer] = useState<Composer>("closed");
  const [draft, setDraft] = useState("");
  const [attachPath, setAttachPath] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<UploadChatImageAttachment>>([]);
  // Desktop's default follow-up while a run is going is to queue; Tab steers instead.
  const [steer, setSteer] = useState(false);
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [picking, setPicking] = useState(false);
  const [verbose, setVerbose] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [scroll, setScroll] = useState(0);
  const startTurn = useCommand(atoms.threadEnvironment.startTurn);
  const interrupt = useCommand(atoms.threadEnvironment.interruptTurn);
  const setRuntimeMode = useCommand(atoms.threadEnvironment.setRuntimeMode);
  const setInteractionMode = useCommand(atoms.threadEnvironment.setInteractionMode);
  const respondToApproval = useCommand(atoms.threadEnvironment.respondToApproval);
  const respondToUserInput = useCommand(atoms.threadEnvironment.respondToUserInput);
  const dismissUserInput = useCommand(atoms.threadEnvironment.dismissUserInput);
  const cancelQueuedRun = useCommand(atoms.threadEnvironment.cancelQueuedRun);
  const promoteQueuedRun = useCommand(atoms.threadEnvironment.promoteQueuedRun);
  const forkFromRun = useCommand(atoms.threadEnvironment.forkFromRun);

  const projection = thread?.projection ?? null;
  const setStatus = useContext(StatusContext);
  const registry = useContext(RegistryContext);
  const wakeHost = useWakeHost(atoms);
  // Opening a thread on a host that stays unreachable wakes it, once per visit.
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = AsyncResult.value(registry.get(atoms.catalog.stateAtom(environmentId)));
      if (Option.isSome(state) && state.value.phase === "connected") return;
      void wakeHost(environmentId).then((message) => message && setStatus(message));
    }, 3000);
    return () => clearTimeout(timer);
  }, [atoms, environmentId, registry, setStatus, wakeHost]);
  const catalogEntry = useAtomValue(atoms.catalog.catalogValueAtom).entries.get(environmentId);
  const snapshot = useAtomValue(atoms.snapshotAtom(environmentId));
  const workspace =
    projection?.thread.worktreePath ??
    snapshot?.projects.find((project) => project.id === projection?.thread.projectId)
      ?.workspaceRoot ??
    null;
  const remoteHost =
    catalogEntry === undefined ||
    (catalogEntry.target._tag === "BearerConnectionTarget" &&
      catalogEntry.target.connectionId === LOCAL_CONNECTION_ID)
      ? null
      : Option.match(catalogEntry.profile, {
          onNone: () => null,
          onSome: (profile) =>
            "httpBaseUrl" in profile ? new URL(profile.httpBaseUrl).hostname : null,
        });
  const openShell = () => {
    if (workspace === null) return setStatus("This thread has no workspace yet.");
    if (remoteHost === null) return setStatus(`On this machine: ${workspace}`);
    const command = remoteShellCommand(remoteHost, workspace);
    if (parentNvim() === null) return setStatus(command);
    void runInParentNvim(floatTerminalLua(command)).then((error) => {
      if (error) setStatus(error);
    });
  };
  const running = projection !== null && hasActiveRun(projection);
  const approval = pending?.approvals[0] ?? null;
  const question = pending?.userInputs[0] ?? null;
  const model = modelOverride ?? projection?.thread.modelSelection ?? null;
  const interactionMode = projection?.thread.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
  const actionablePlan =
    projection?.plans.findLast(
      (plan) => plan.kind === "proposed_plan" && plan.status === "active",
    ) ?? null;
  const queued = queue?.queuedRuns ?? [];
  const sentMessages = useMemo(
    () =>
      (projection?.messages ?? [])
        .filter((message) => message.role === "user" && message.createdBy === "user")
        .map((message) => message.text),
    [projection?.messages],
  );
  const width = Math.max(20, columns - 2);
  const rows = useMemo(() => {
    const out: Array<{ key: string; tone: LineTone; text: string }> = [];
    for (const line of transcriptLines(projection?.visibleTurnItems ?? [], { verbose })) {
      wrapText(line.text, width).forEach((text, index) =>
        out.push({ key: `${line.key}:${index}`, tone: line.tone, text }),
      );
    }
    return out;
  }, [projection?.visibleTurnItems, width, verbose]);

  const questionLines = question
    ? 3 + (question.questions[0]?.options.length ?? 0) + (answering ? 1 : 0)
    : 0;
  const footer =
    (approval ? 2 : 0) +
    questionLines +
    Math.min(queued.length, 3) +
    (attachments.length > 0 ? 1 : 0) +
    (actionablePlan && !running ? 1 : 0) +
    4;
  const visible = Math.max(3, height - footer - 3);
  const maxScroll = Math.max(0, rows.length - visible);
  const offset = Math.min(scroll, maxScroll);
  const shown = rows.slice(rows.length - visible - offset, rows.length - offset);

  const send = (text: string, extra: { readonly planId?: PlanId } = {}) => {
    if (!projection || (text.trim() === "" && attachments.length === 0)) return;
    setDraft("");
    setAttachments([]);
    setComposer("closed");
    setHistoryIndex(null);
    void startTurn({
      environmentId,
      input: {
        commandId: CommandId.make(NodeCrypto.randomUUID()),
        threadId,
        message: {
          messageId: MessageId.make(NodeCrypto.randomUUID()),
          role: "user",
          text,
          attachments,
        },
        ...(modelOverride ? { modelSelection: modelOverride } : {}),
        runtimeMode: projection.thread.runtimeMode,
        interactionMode: extra.planId ? "default" : interactionMode,
        ...(extra.planId ? { sourceProposedPlan: { threadId, planId: extra.planId } } : {}),
        ...(running ? { dispatchMode: steer ? "steer" : "queue" } : {}),
        createdAt: new Date().toISOString(),
      },
    });
  };

  const attach = async (bytes: Uint8Array | null, name: string) => {
    if (bytes === null) return setStatus("No image on the clipboard.");
    const attachment = imageAttachment(name, bytes);
    if ("error" in attachment) return setStatus(attachment.error);
    setAttachments((current) => [...current, attachment]);
    setStatus(`Attached ${name}.`);
  };
  const attachFile = (typed: string) => {
    setComposer(draft ? "reply" : "closed");
    setAttachPath("");
    const path = expandPath(typed, NodeOS.homedir());
    if (!path) return;
    void NodeFSP.readFile(path).then(
      (bytes) => attach(new Uint8Array(bytes), NodePath.basename(path)),
      () => setStatus(`Can't read ${path}.`),
    );
  };
  const pasteImage = () =>
    void readClipboardImage().then((bytes) => attach(bytes, `pasted-${Date.now()}.png`));

  const implementPlan = () => {
    if (!actionablePlan || actionablePlan.kind !== "proposed_plan" || running) return;
    void setInteractionMode({
      environmentId,
      input: { threadId, interactionMode: "default" },
    }).then((result) => {
      if (result !== null)
        send(buildPlanImplementationPrompt(actionablePlan.markdown), { planId: actionablePlan.id });
    });
  };

  const fork = () => {
    const run = projection?.runs.findLast((candidate) => candidate.status === "completed");
    if (!run) return setStatus("Nothing finished to fork from yet.");
    const targetThreadId = ThreadId.make(NodeCrypto.randomUUID());
    void forkFromRun({
      environmentId,
      input: { sourceThreadId: threadId, targetThreadId, runId: run.id },
    }).then((result) => {
      if (result !== null) props.onOpenThread(environmentId, targetThreadId);
    });
  };

  const browsing = props.active && composer === "closed" && !picking && !answering;
  useKeys(
    (input, key) => {
      if (key.escape) return props.onBack();
      if (input === "i" || input === "r") {
        // With a question up, `i` belongs to the question panel.
        if (question && input === "i") return;
        return setComposer("reply");
      }
      if (input === "d" && projection) {
        const turns = Math.max(
          0,
          ...projection.checkpoints.map((checkpoint) => checkpoint.appRunOrdinal ?? 0),
        );
        return turns > 0 ? props.onDiff(turns) : setStatus("No changes yet.");
      }
      if (input === "o") return openShell();
      if (input === "v") return setVerbose(!verbose);
      if (input === "M") return setPicking(true);
      if (input === "e" && model) {
        const next = cycleEffort(model, config);
        return next ? setModelOverride(next) : setStatus("This model has no effort setting.");
      }
      if (input === "p" && projection) {
        void setInteractionMode({
          environmentId,
          input: { threadId, interactionMode: interactionMode === "plan" ? "default" : "plan" },
        });
        return;
      }
      if (input === "I") return implementPlan();
      if (input === "+") return setComposer("attach");
      if (key.ctrl && input === "v") return pasteImage();
      if (input === "F") return fork();
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
        if (next) void setRuntimeMode({ environmentId, input: { threadId, runtimeMode: next } });
        return;
      }
      if (input === "s" && running) {
        void interrupt({ environmentId, input: { threadId } });
        return;
      }
      const last = queued.at(-1);
      if (input === "c" && last) {
        void cancelQueuedRun({ environmentId, input: { threadId, runId: last.run.id } });
        return;
      }
      const first = queued[0];
      if (input === "!" && first) {
        if (!queue?.canPromoteToSteer || !queue.activeRun)
          return setStatus("This run can't take a steer right now; it stays queued.");
        void promoteQueuedRun({
          environmentId,
          input: { threadId, queuedRunId: first.run.id, targetRunId: queue.activeRun.id },
        });
        return;
      }
      if (approval && (input === "y" || input === "a" || input === "n")) {
        void respondToApproval({
          environmentId,
          input: {
            threadId,
            requestId: approval.requestId,
            decision: input === "y" ? "accept" : input === "a" ? "acceptForSession" : "decline",
          },
        });
      }
    },
    { isActive: browsing },
  );
  useKeys(
    (input, key) => {
      if (key.escape) {
        setComposer("closed");
        return setHistoryIndex(null);
      }
      if (composer !== "reply") return;
      if (key.tab && running) return setSteer(!steer);
      if (key.ctrl && input === "v") return pasteImage();
      // ↑/↓ in an empty (or recalled) draft walk back through what you sent.
      if ((key.upArrow || key.downArrow) && (draft === "" || historyIndex !== null)) {
        const count = sentMessages.length;
        if (count === 0) return;
        const next =
          historyIndex === null
            ? key.upArrow
              ? count - 1
              : null
            : key.upArrow
              ? Math.max(0, historyIndex - 1)
              : historyIndex + 1 >= count
                ? null
                : historyIndex + 1;
        setHistoryIndex(next);
        setDraft(next === null ? "" : (sentMessages[next] ?? ""));
      }
    },
    { isActive: props.active && composer !== "closed" },
  );

  if (picking) {
    const choices = hostModels(config).map((selection) => ({
      label: modelLabel(selection, config),
      detail: selection.instanceId,
      value: selection,
    }));
    return h(Picker<ModelSelection>, {
      title: "Model for the next message",
      choices,
      active: props.active,
      initialIndex: Math.max(
        0,
        choices.findIndex(
          (choice) =>
            choice.value.instanceId === model?.instanceId && choice.value.model === model?.model,
        ),
      ),
      onCancel: () => setPicking(false),
      onPick: (selection) => {
        setPicking(false);
        setModelOverride(selection);
      },
    });
  }

  const state = Option.getOrNull(
    stateResult._tag === "Success" ? Option.some(stateResult.value) : Option.none(),
  );
  const title = projection?.thread.title ?? "Loading…";
  const hints = [
    question ? null : "i reply",
    running ? "s stop" : null,
    "d diff",
    remoteHost ? "o shell" : null,
    "M model",
    "e effort",
    `p ${interactionMode === "plan" ? "plan→chat" : "plan"}`,
    `m ${projection?.thread.runtimeMode ?? "mode"}`,
    "+ image",
    `v ${verbose ? "brief" : "detail"}`,
    "F fork",
    offset > 0 ? `${offset} up, G end` : "pgup/pgdn",
    "esc back",
  ].filter(Boolean);

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
    question
      ? h(QuestionPanel, {
          key: question.requestId,
          request: question,
          active: props.active && composer === "closed" && !picking,
          onTypingChange: setAnswering,
          onAnswer: (answers) =>
            void respondToUserInput({
              environmentId,
              input: { threadId, requestId: question.requestId, answers },
            }),
          onDismiss: () =>
            void dismissUserInput({
              environmentId,
              input: { threadId, requestId: question.requestId },
            }),
        })
      : null,
    actionablePlan && !running
      ? h(Text, { color: "green" }, "Plan ready · I implement it · i to refine")
      : null,
    queued.length > 0
      ? h(
          Box,
          { flexDirection: "column", marginTop: 1 },
          ...queued
            .slice(-3)
            .map((entry) =>
              h(
                Text,
                { key: entry.run.id, dimColor: true, wrap: "truncate" },
                `⏳ ${entry.text.split("\n")[0] ?? ""}`,
              ),
            ),
          h(Text, { dimColor: true }, "queued after this run · c cancel last · ! steer first now"),
        )
      : null,
    attachments.length > 0
      ? h(
          Text,
          { color: "cyan", wrap: "truncate" },
          `📎 ${attachments.map((attachment) => attachment.name).join(", ")}`,
        )
      : null,
    h(
      Text,
      { dimColor: true, wrap: "truncate" },
      `${model ? modelLabel(model, config) : ""}${modelOverride ? " (next message)" : ""}${interactionMode === "plan" ? " · plan mode" : ""}`,
    ),
    h(
      Box,
      null,
      composer === "reply"
        ? h(
            Box,
            { flexDirection: "column" },
            h(TextInput, {
              value: draft,
              active: props.active,
              multiline: true,
              placeholder: running ? (steer ? "Steer the run…" : "Queue a follow-up…") : "Reply…",
              onChange: (value) => {
                setDraft(value);
                setHistoryIndex(null);
              },
              onSubmit: send,
            }),
            h(
              Text,
              { dimColor: true },
              `enter ${running ? (steer ? "steer" : "queue") : "send"}${running ? ` · tab ${steer ? "queue" : "steer"}` : ""} · alt+enter newline · ↑ last sent · ctrl+v paste image · esc`,
            ),
          )
        : composer === "attach"
          ? h(
              Box,
              { flexDirection: "column" },
              h(Text, null, "Image to attach (path; drag a file in):"),
              h(TextInput, {
                value: attachPath,
                active: props.active,
                placeholder: "~/Desktop/screenshot.png",
                onChange: setAttachPath,
                onSubmit: attachFile,
              }),
            )
          : h(Text, { dimColor: true, wrap: "wrap" }, hints.join(" · ")),
    ),
  );
}
