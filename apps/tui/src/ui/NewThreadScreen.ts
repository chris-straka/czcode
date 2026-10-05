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
import { Box, Text, useInput } from "ink";
import { createElement as h, useMemo, useState } from "react";
import { randomBytes, randomUUID } from "node:crypto";
import { buildTemporaryWorktreeBranchName } from "@cz/shared/git";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { hostModels, liveProjects, newThreadModel } from "../model/hosts.ts";
import { projectKey } from "../model/scope.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { useCommand } from "./command.ts";
import { environmentShellsAtom } from "./ThreadListScreen.ts";
import { TextInput } from "./TextInput.ts";

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

  useInput(
    (input, key) => {
      if (key.escape) return props.onCancel();
      if (key.downArrow || input === "j") setCursor(Math.min(choices.length - 1, cursor + 1));
      else if (key.upArrow || input === "k") setCursor(Math.max(0, cursor - 1));
      else if (key.return) {
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
  useInput(
    (_input, key) => {
      if (key.escape) return props.onCancel();
      if (key.tab) return setEnvModeChoice(envMode === "worktree" ? "local" : "worktree");
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
        "enter send · alt+enter newline · ↑↓ model · tab worktree/local · esc",
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
