import { filterChips, filterFeed } from "@cz/client-runtime/decisions/feed";
import type { DecisionAnswerInput, DecisionKind, DecisionMediaRef } from "@cz/contracts";
import { CheckIcon, InboxIcon, PlayIcon, UndoIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { type DecisionEntry, decisionEnvironment, useOpenDecisions } from "~/state/decisions";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { DecisionMedia } from "./DecisionMedia";
import { DecisionView, type UploadDecisionMedia } from "./DecisionView";
import { answerSummary, VERDICT_BUTTONS } from "./decisionDraft";

/** How long an answer can be undone before it is sent. */
const UNDO_WINDOW_MS = 5_000;

const entryKey = (entry: Pick<DecisionEntry, "environmentId" | "item">) =>
  `${entry.environmentId}:${entry.item.id}`;

interface PendingAnswer {
  readonly entry: DecisionEntry;
  readonly answer: DecisionAnswerInput;
  readonly timer: ReturnType<typeof setTimeout>;
}

function ageLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - createdAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function DecisionsPage() {
  const feed = useOpenDecisions();
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const uploadCommand = useAtomCommand(decisionEnvironment.upload, "upload decision media");
  const [projects, setProjects] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [session, setSession] = useState(false);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingAnswer>>(new Map());
  const [sent, setSent] = useState<ReadonlyMap<string, { entry: DecisionEntry; summary: string }>>(
    new Map(),
  );
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const chips = useMemo(() => filterChips(feed.entries.map((entry) => entry.item)), [feed.entries]);
  const visible = useMemo(() => {
    const items = new Set(
      filterFeed(
        feed.entries.map((entry) => entry.item),
        { projects: new Set(projects), kinds: new Set(kinds as DecisionKind[]) },
      ),
    );
    // Answered items stay hidden until the next refresh drops them from the feed.
    return feed.entries.filter(
      (entry) =>
        items.has(entry.item) && !pending.has(entryKey(entry)) && !sent.has(entryKey(entry)),
    );
  }, [feed.entries, projects, kinds, pending, sent]);

  const send = useCallback(
    async (key: string) => {
      const item = pendingRef.current.get(key);
      if (!item) return;
      setPending((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      const result = await answerCommand({
        environmentId: item.entry.environmentId,
        input: { id: item.entry.item.id, answer: item.answer },
      });
      if (result._tag === "Success") {
        setSent((current) =>
          new Map(current).set(key, {
            entry: item.entry,
            summary: answerSummary(item.entry.item, item.answer),
          }),
        );
      }
    },
    [answerCommand],
  );

  useEffect(
    () => () => {
      for (const item of pendingRef.current.values()) clearTimeout(item.timer);
    },
    [],
  );

  const answer = (entry: DecisionEntry, value: DecisionAnswerInput) => {
    const key = entryKey(entry);
    const timer = setTimeout(() => void send(key), UNDO_WINDOW_MS);
    setPending((current) => new Map(current).set(key, { entry, answer: value, timer }));
    if (session) {
      const next = visible.find((candidate) => entryKey(candidate) !== key);
      setOpenKey(next ? entryKey(next) : null);
      if (!next) setSession(false);
    } else {
      setOpenKey(null);
    }
  };

  const undo = (key: string) => {
    const item = pending.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    setPending((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const opened = openKey === null ? null : visible.find((entry) => entryKey(entry) === openKey);
  const upload: UploadDecisionMedia | null = opened
    ? async (meta, bytes) => {
        const result = await uploadCommand({
          environmentId: opened.environmentId,
          input: { meta, bytes },
        });
        return result._tag === "Success" ? (result.value as DecisionMediaRef) : null;
      }
    : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {opened && upload ? (
          <DecisionView
            key={openKey}
            entry={opened}
            {...(session
              ? {
                  position: { index: visible.indexOf(opened), total: visible.length },
                  onSkip: () => {
                    const index = visible.indexOf(opened);
                    const next = visible[index + 1] ?? visible[0];
                    setOpenKey(next ? entryKey(next) : null);
                  },
                }
              : {})}
            onSubmit={(value) => answer(opened, value)}
            onUpload={upload}
            onClose={() => {
              setOpenKey(null);
              setSession(false);
            }}
          />
        ) : (
          <>
            <WorkspacePageHeader electron={isElectron} className="border-b border-border">
              <div className="flex w-full items-center gap-2">
                <span className="text-sm font-medium text-foreground">Decisions</span>
                {visible.length > 0 ? (
                  <Badge variant="secondary" size="sm">
                    {visible.length}
                  </Badge>
                ) : null}
                <div className="ml-auto">
                  <Button
                    size="sm"
                    disabled={visible.length === 0}
                    onClick={() => {
                      setSession(true);
                      setOpenKey(visible[0] ? entryKey(visible[0]) : null);
                    }}
                  >
                    <PlayIcon />
                    Review all
                  </Button>
                </div>
              </div>
            </WorkspacePageHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4">
                {chips.projects.length + chips.kinds.length > 1 ? (
                  <div className="flex flex-wrap gap-2" aria-label="Filters">
                    <ToggleGroup
                      multiple
                      value={projects}
                      onValueChange={(value) => setProjects(value as string[])}
                    >
                      {chips.projects.map((project) => (
                        <Toggle key={project} size="sm" value={project}>
                          {project}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                    <ToggleGroup
                      multiple
                      value={kinds}
                      onValueChange={(value) => setKinds(value as string[])}
                    >
                      {chips.kinds.map((kind) => (
                        <Toggle key={kind} size="sm" value={kind}>
                          {kind}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                  </div>
                ) : null}

                {[...pending.entries()].map(([key, item]) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
                    data-decision-pending
                  >
                    <CheckIcon className="size-4 text-success-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.entry.item.title}: {answerSummary(item.entry.item, item.answer)}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => undo(key)}>
                      <UndoIcon />
                      Undo
                    </Button>
                  </div>
                ))}

                {feed.isPending ? (
                  <>
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-28 w-full" />
                  </>
                ) : visible.length === 0 && pending.size === 0 ? (
                  <Empty className="min-h-64">
                    <EmptyMedia variant="icon">
                      <InboxIcon />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>Nothing to decide</EmptyTitle>
                      <EmptyDescription>Agents' questions show up here.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  visible.map((entry) => (
                    <DecisionCard
                      key={entryKey(entry)}
                      entry={entry}
                      age={ageLabel(entry.item.created_at, now)}
                      onOpen={() => setOpenKey(entryKey(entry))}
                      onQuickAnswer={(choice) =>
                        answer(entry, {
                          choice,
                          option_ids: null,
                          rank: null,
                          comment: null,
                          voice_key: null,
                        })
                      }
                    />
                  ))
                )}

                {[...sent.values()].length > 0 ? (
                  <div className="space-y-1 pt-2 text-xs text-muted-foreground">
                    {[...sent.values()].map(({ entry, summary }) => (
                      <div key={entryKey(entry)}>
                        Answered {entry.item.title}: {summary}
                      </div>
                    ))}
                  </div>
                ) : null}

                {feed.unreachable.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Couldn't reach {feed.unreachable.join(", ")}; their decisions show up when
                    they're back.
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </SidebarInset>
  );
}

/** A feed card shaped by its kind, so many decisions never need opening. */
function DecisionCard({
  entry,
  age,
  onOpen,
  onQuickAnswer,
}: {
  entry: DecisionEntry;
  age: string;
  onOpen: () => void;
  onQuickAnswer: (choice: string) => void;
}) {
  const { item } = entry;
  const quick = item.kind === "review" || item.kind === "pitch" ? VERDICT_BUTTONS[item.kind] : null;
  const thumbnails =
    item.kind === "pick"
      ? item.options.flatMap((option) => {
          const media = option.media_idx === null ? undefined : item.media[option.media_idx];
          // Only pictures make useful thumbnails; sounds and models open the full view.
          return media?.type === "image" ? [media] : [];
        })
      : [];
  const apk =
    item.kind === "playtest" ? item.media.find((media) => media.type === "apk") : undefined;
  return (
    <article
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-decision-card={item.kind}
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary" size="sm">
            {item.kind}
          </Badge>
          <span>{item.project}</span>
          {item.blocking ? (
            <Badge variant="warning" size="sm">
              Agent waiting
            </Badge>
          ) : null}
          <span className="ml-auto">{age}</span>
        </div>
        <h2 className="mt-1 font-medium text-foreground">{item.question}</h2>
        {item.cost_note ? (
          <p className="text-xs text-warning-foreground">{item.cost_note}</p>
        ) : null}
      </button>
      {thumbnails.length > 0 ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn("grid gap-2", thumbnails.length > 2 ? "grid-cols-4" : "grid-cols-2")}
        >
          {thumbnails.slice(0, 4).map((media) => (
            <DecisionMedia
              key={media.key}
              environmentId={entry.environmentId}
              media={media}
              compact
            />
          ))}
        </button>
      ) : null}
      {quick || apk ? (
        <div className="flex flex-wrap gap-2">
          {apk ? <DecisionMedia environmentId={entry.environmentId} media={apk} /> : null}
          {quick?.map((button) => (
            <Button
              key={button.value}
              size="sm"
              variant={button.value === "approve" || button.value === "yes" ? "default" : "outline"}
              onClick={() => (button.value === "changes" ? onOpen() : onQuickAnswer(button.value))}
            >
              {button.label}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
