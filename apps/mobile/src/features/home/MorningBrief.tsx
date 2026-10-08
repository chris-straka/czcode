import { useAtomValue } from "@effect/atom-react";
import {
  type BriefLine,
  buildMorningBrief,
  formatBriefSince,
  morningBriefIsEmpty,
  morningBriefReadToday,
} from "@cz/client-runtime/decisions/morningBrief";
import type { EnvironmentId } from "@cz/contracts";
import { useNavigation } from "@react-navigation/native";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import {
  decisionEnvironment,
  useFilteredOpenDecisions,
  useMachineBriefs,
} from "../../state/decisions";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { fleetAtom } from "../../state/fleet";
import { useJobsOn } from "../../state/jobs";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadListActions } from "./useThreadListActions";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** When Done was pressed in this app session, so the brief stays gone before the servers say so. */
let readHereAt: number | null = null;

/**
 * The Morning brief at the top of the phone's feed, once a day: a few written
 * lines on what happened on every machine since the owner last read one. It
 * never lists threads. Done hides it on every device until tomorrow.
 */
export function MorningBrief() {
  const navigation = useNavigation();
  const [now] = useState(Date.now);
  const { entries } = useFilteredOpenDecisions();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const jobs = useJobsOn(environmentIds);
  const machines = useMachineBriefs(environmentIds);
  const fleet = useAtomValue(fleetAtom);
  const markRead = useAtomCommand(decisionEnvironment.briefRead, { reportFailure: false });
  const [readHere, setReadHere] = useState(readHereAt);
  const brief = useMemo(
    () => buildMorningBrief({ machines, decisions: entries, threads, jobs, fleet }),
    [machines, entries, threads, jobs, fleet],
  );

  const readToday =
    morningBriefReadToday(brief, now) ||
    (readHere !== null && morningBriefReadToday({ ...brief, readAt: readHere }, now));
  if (readToday || morningBriefIsEmpty(brief)) return null;

  const done = () => {
    readHereAt = Date.now();
    setReadHere(readHereAt);
    for (const environmentId of environmentIds) {
      void markRead({ environmentId, input: undefined });
    }
  };

  const top = brief.decisions.top;
  return (
    <View className="mx-4 mb-2 gap-4 rounded-xl border border-border bg-subtle p-4">
      <View className="flex-row items-center gap-2">
        <Text className="font-cz-medium text-base text-foreground">Morning brief</Text>
        <Text className="flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {brief.since === null ? "" : `since ${formatBriefSince(brief.since, now)}`}
          {brief.writing ? " · writing…" : ""}
        </Text>
        <Pressable onPress={done} hitSlop={8}>
          <Text className="text-sm text-primary">Done</Text>
        </Pressable>
      </View>

      {brief.done.length > 0 ? (
        <BriefSection title="Done">
          {brief.done.map((line) => (
            <BriefLineRow key={line.key} line={line} />
          ))}
        </BriefSection>
      ) : null}

      {brief.failed.length > 0 ? (
        <BriefSection title="Failed or stopped">
          {brief.failed.map((line) => (
            <BriefLineRow key={line.key} line={line} />
          ))}
        </BriefSection>
      ) : null}

      {top !== null || brief.waiting > 0 ? (
        <BriefSection title="Needs you">
          {top ? (
            <Pressable
              onPress={() =>
                navigation.navigate("Decision", {
                  environmentId: top.environmentId,
                  id: top.item.id,
                })
              }
            >
              <Text className="text-sm text-foreground">
                <Text className="font-cz-medium">{plural(brief.decisions.total, "Decision")}</Text>
                <Text className="text-foreground-muted">
                  {": "}
                  {brief.decisions.byProject
                    .map(({ project, count }) => `${count} ${project}`)
                    .join(", ")}
                </Text>
              </Text>
            </Pressable>
          ) : null}
          {brief.waiting > 0 ? (
            <Text className="text-sm text-foreground-muted">
              {brief.waiting === 1
                ? "1 agent is waiting on an answer, below"
                : `${brief.waiting} agents are waiting on an answer, below`}
            </Text>
          ) : null}
        </BriefSection>
      ) : null}

      {brief.machines.length > 0 ? (
        <BriefSection title="Machines">
          {brief.machines.map((machine) => (
            <Pressable key={machine.environmentId} onPress={() => navigation.navigate("Fleet")}>
              <Text className="text-sm text-foreground">
                <Text className="font-cz-medium">{machine.label}</Text>
                <Text className="text-foreground-muted"> {machine.problem}</Text>
              </Text>
            </Pressable>
          ))}
        </BriefSection>
      ) : null}
    </View>
  );
}

function BriefSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-cz-medium uppercase tracking-wide text-foreground-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** "hll: Andras rigged in game". Failed and stopped lines carry their one action. */
function BriefLineRow({ line }: { readonly line: BriefLine }) {
  const navigation = useNavigation();
  const retry = useAtomCommand(decisionEnvironment.retryThreads, "retry threads");
  const { archiveThread } = useThreadListActions();
  const shells = useThreadShells();

  const onRetry = () => {
    const byMachine = new Map<EnvironmentId, string[]>();
    for (const thread of line.threads) {
      byMachine.set(thread.environmentId, [
        ...(byMachine.get(thread.environmentId) ?? []),
        thread.threadId,
      ]);
    }
    for (const [environmentId, threadIds] of byMachine) {
      void retry({ environmentId, input: { threadIds } });
    }
  };
  const onDismiss = () => {
    for (const ref of line.threads) {
      const shell = shells.find(
        (thread) => thread.environmentId === ref.environmentId && thread.id === ref.threadId,
      );
      if (shell) archiveThread(shell);
    }
  };

  const text = (
    <Text className="text-sm text-foreground">
      <Text className="font-cz-medium">{line.label}</Text>
      <Text className="text-foreground-muted">: </Text>
      {line.text}
    </Text>
  );
  return (
    <View className="flex-row items-start gap-2">
      {line.jobs.length > 0 ? (
        <Pressable
          className="flex-1"
          onPress={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsSchedules" },
            })
          }
        >
          {text}
        </Pressable>
      ) : (
        <View className="flex-1">{text}</View>
      )}
      {line.action === "open" || line.threads.length === 0 ? null : (
        <Pressable
          className="rounded-lg border border-border px-2.5 py-1"
          hitSlop={6}
          onPress={line.action === "retry" ? onRetry : onDismiss}
        >
          <Text className="text-xs text-foreground">
            {line.action === "retry" ? "Retry" : "Dismiss"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
