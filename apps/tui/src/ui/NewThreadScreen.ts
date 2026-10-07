import { useAtomValue } from "@effect/atom-react";
import { deriveThreadTitleSeed } from "@cz/client-runtime/operations";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  MessageId,
  type OrchestrationProjectShell,
  ThreadId,
  type ThreadEnvMode,
  type VcsStatusResult,
} from "@cz/contracts";
import { Box, Text } from "ink";
import { createElement as h, useContext, useMemo, useState } from "react";
import { randomBytes, randomUUID } from "node:crypto";
import { buildTemporaryWorktreeBranchName } from "@cz/shared/git";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { hostModels, liveProjects, newThreadModel } from "../model/hosts.ts";
import { projectKey } from "../model/scope.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { queuedRunStartLabel } from "@cz/client-runtime/state/queue";
import { environmentShellsAtom } from "./ThreadListScreen.ts";
import { TextInput } from "./TextInput.ts";
import { useKeys, useVimMotion } from "./input.ts";

const NO_VCS_STATUS = Atom.make(AsyncResult.initial<VcsStatusResult | null, unknown>());

type Step =
  | { readonly kind: "host" }
  | { readonly kind: "project"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "prompt";
      readonly environmentId: EnvironmentId;
      readonly project: OrchestrationProjectShell;
    };

/** Pick a host (skipped with one), a project on it, then type the first message. */
export function NewThreadScreen(props: {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
  readonly onStarted: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  readonly onCancel: () => void;
  /** Projects in the current scope: the project step starts on one of them. */
  readonly scope: ReadonlySet<string> | null;
}) {
  const { atoms } = props;
  const shellsAtom = useMemo(() => environmentShellsAtom(atoms), [atoms]);
  const hosts = useAtomValue(shellsAtom).filter((host) => host.snapshot !== null);
  const configs = useAtomValue(atoms.serverConfigsAtom);
  const [step, setStep] = useState<Step>(() =>
    hosts.length === 1 && hosts[0]
      ? { kind: "project", environmentId: hosts[0].environmentId }
      : { kind: "host" },
  );
  // With one host the project step comes first: start it on the scoped project.
  const [cursor, setCursor] = useState(() => {
    const only = hosts.length === 1 ? hosts[0] : undefined;
    if (!only) return 0;
    const index = liveProjects(only.snapshot).findIndex(
      (project) => props.scope?.has(projectKey(only.environmentId, project.id)) ?? false,
    );
    return Math.max(0, index);
  });
  const [prompt, setPrompt] = useState("");
  // Index into the host's models; null keeps the project/host default.
  const [modelIndex, setModelIndex] = useState<number | null>(null);
  // null follows the project, then host setting; Tab flips it for this thread.
  const [envModeChoice, setEnvModeChoice] = useState<ThreadEnvMode | null>(null);
  const startTurn = useCommand(atoms.threadEnvironment.startTurn);
  const enqueue = useCommand(atoms.queue.enqueue);
  const setStatus = useContext(StatusContext);

  const scopedIndex = (environmentId: EnvironmentId) => {
    const list = liveProjects(
      hosts.find((host) => host.environmentId === environmentId)?.snapshot ?? null,
    );
    return Math.max(
      0,
      list.findIndex((project) => props.scope?.has(projectKey(environmentId, project.id)) ?? false),
    );
  };
  const projects =
    step.kind === "project"
      ? liveProjects(
          hosts.find((host) => host.environmentId === step.environmentId)?.snapshot ?? null,
        )
      : [];
  const choices =
    step.kind === "host"
      ? hosts.map((host) => host.label)
      : projects.map((project) => project.title);

  const vim = useVimMotion();
  useKeys(
    (input, key) => {
      if (key.escape) return props.onCancel();
      if (
        vim(input, key, {
          cursor,
          count: choices.length,
          page: 10,
          onMove: setCursor,
          onBack: props.onCancel,
        })
      )
        return;
      if (key.return) {
        if (step.kind === "host") {
          const host = hosts[cursor];
          if (host) {
            setStep({ kind: "project", environmentId: host.environmentId });
            setCursor(scopedIndex(host.environmentId));
            return;
          }
        } else if (step.kind === "project") {
          const project = projects[cursor];
          if (project) setStep({ kind: "prompt", environmentId: step.environmentId, project });
        }
        setCursor(0);
      }
    },
    { isActive: props.active && step.kind !== "prompt" },
  );
  const promptConfig = step.kind === "prompt" ? (configs.get(step.environmentId) ?? null) : null;
  const models = hostModels(promptConfig);
  const defaultModel = step.kind === "prompt" ? newThreadModel(step.project, promptConfig) : null;
  const chosenModel = modelIndex === null ? defaultModel : (models[modelIndex] ?? defaultModel);
  const envMode: ThreadEnvMode =
    envModeChoice ??
    (step.kind === "prompt" ? step.project.defaultThreadEnvMode : null) ??
    promptConfig?.settings.defaultThreadEnvMode ??
    "local";
  const statusAtom: Atom.Atom<AsyncResult.AsyncResult<VcsStatusResult | null, unknown>> =
    step.kind === "prompt"
      ? atoms.vcs.status({
          environmentId: step.environmentId,
          input: { cwd: step.project.workspaceRoot },
        })
      : NO_VCS_STATUS;
  const vcsResult = useAtomValue(statusAtom);
  const vcsStatus = Option.getOrNull(AsyncResult.value(vcsResult));
  const baseBranch = vcsStatus?.isRepo ? vcsStatus.refName : null;
  useKeys(
    (_input, key) => {
      if (key.escape) return props.onCancel();
      if (key.tab) return setEnvModeChoice(envMode === "worktree" ? "local" : "worktree");
      if (key.ctrl && _input === "r") return queueForReset(prompt);
      if ((key.upArrow || key.downArrow) && models.length > 0) {
        const current =
          modelIndex ??
          Math.max(
            0,
            models.findIndex(
              (model) =>
                model.instanceId === defaultModel?.instanceId && model.model === defaultModel.model,
            ),
          );
        const step = key.downArrow ? 1 : -1;
        setModelIndex((current + step + models.length) % models.length);
      }
    },
    { isActive: props.active && step.kind === "prompt" },
  );

  /** Queues the prompt to start as a thread when the model's quota resets. */
  const queueForReset = (text: string) => {
    if (step.kind !== "prompt" || text.trim() === "" || chosenModel === null) return;
    const title = deriveThreadTitleSeed({ text, attachments: [] }).slice(0, 80) || "Queued task";
    void enqueue({
      environmentId: step.environmentId,
      input: {
        title,
        prompt: text.trim(),
        projectId: step.project.id,
        modelSelection: chosenModel,
        workspaceStrategy:
          envMode === "worktree" && baseBranch !== null
            ? { type: "worktree", baseRef: baseBranch }
            : { type: "root" },
        start: "reset",
        source: "composer",
      },
    }).then((run) => {
      if (run === null) return;
      setStatus(`Queued: it ${queuedRunStartLabel(run, Date.now())}. See the Queue tab.`);
      props.onCancel();
    });
  };

  const send = (text: string) => {
    if (step.kind !== "prompt" || text.trim() === "") return;
    const config = configs.get(step.environmentId) ?? null;
    const modelSelection = chosenModel;
    if (modelSelection === null) return;
    // A worktree needs the branch to start from; until git status arrives, wait.
    if (envMode === "worktree" && baseBranch === null) return;
    const runtimeMode = config?.settings.defaultRuntimeMode ?? "approval-required";
    const interactionMode = DEFAULT_PROVIDER_INTERACTION_MODE;
    const threadId = ThreadId.make(randomUUID());
    const createdAt = new Date().toISOString();
    const title = deriveThreadTitleSeed({ text, attachments: [] });
    void startTurn({
      environmentId: step.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        threadId,
        message: { messageId: MessageId.make(randomUUID()), role: "user", text, attachments: [] },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        bootstrap: {
          createThread: {
            projectId: step.project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode,
            branch: null,
            worktreePath: null,
            createdAt,
          },
          ...(envMode === "worktree" && baseBranch !== null
            ? {
                prepareWorktree: {
                  projectCwd: step.project.workspaceRoot,
                  baseBranch,
                  branch: buildTemporaryWorktreeBranchName((bytes) =>
                    randomBytes(bytes).toString("hex"),
                  ),
                },
                runSetupScript: true,
              }
            : {}),
        },
        createdAt,
      },
    }).then((result) => {
      if (result !== null) props.onStarted(step.environmentId, threadId);
    });
  };

  if (step.kind === "prompt") {
    const host = hosts.find((candidate) => candidate.environmentId === step.environmentId);
    const model = chosenModel;
    return h(
      Box,
      { flexDirection: "column" },
      h(
        Text,
        { dimColor: true },
        `${host?.label ?? ""} · ${step.project.title} · ${model ? `${model.instanceId}/${model.model}` : "no model available"}`,
      ),
      h(
        Text,
        { dimColor: true },
        envMode === "worktree" ? `new worktree from ${baseBranch ?? "…"}` : "in the project folder",
      ),
      h(
        Box,
        { marginTop: 1 },
        h(TextInput, {
          value: prompt,
          active: props.active,
          multiline: true,
          placeholder: "What should the agent do?",
          onChange: setPrompt,
          onSubmit: send,
        }),
      ),
      h(
        Text,
        { dimColor: true },
        "enter send · ctrl+r at next reset · ↑↓ model · tab worktree/local · esc",
      ),
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, step.kind === "host" ? "Run on which host?" : "Which project?"),
    choices.length === 0
      ? h(
          Text,
          { dimColor: true },
          step.kind === "host" ? "No connected hosts." : "No projects on this host.",
        )
      : choices.map((choice, index) =>
          h(
            Text,
            { key: `${index}:${choice}`, ...(index === cursor ? { color: "cyan" } : {}) },
            `${index === cursor ? "› " : "  "}${choice}`,
          ),
        ),
  );
}
