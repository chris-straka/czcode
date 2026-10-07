import { Link, useSearch } from "@tanstack/react-router";
import { filterChips } from "@cz/client-runtime/decisions/feed";
import { buildOneFeed } from "@cz/client-runtime/decisions/oneFeed";
import type { DecisionAnswerInput, DecisionMediaRef, DecisionProjectBlurb } from "@cz/contracts";
import { CheckIcon, InboxIcon, PencilIcon, PlayIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useFeedFilterStore } from "~/feedFilterStore";
import {
  type DecisionEntry,
  type DecisionFeed,
  decisionEnvironment,
  useAnsweredDecisions,
  useFilteredOpenDecisions,
  useOpenDecisions,
  useProjectBlurbs,
} from "~/state/decisions";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { DecisionMedia } from "./DecisionMedia";
import { DecisionView, type UploadDecisionMedia } from "./DecisionView";
import { answerSummary, VERDICT_BUTTONS } from "@cz/client-runtime/decisions/draft";

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
  const filtered = useFilteredOpenDecisions();
  const answered = useAnsweredDecisions();
  const blurbs = useProjectBlurbs();
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const uploadCommand = useAtomCommand(decisionEnvironment.upload, "upload decision media");
  const projects = useFeedFilterStore((state) => state.projects);
  const kinds = useFeedFilterStore((state) => state.kinds);
  const setProjects = useFeedFilterStore((state) => state.setProjects);
  const setKinds = useFeedFilterStore((state) => state.setKinds);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const search = useSearch({ from: "/_chat/decisions" });
  const [openKey, setOpenKey] = useState<string | null>(search.open ?? null);
  const [session, setSession] = useState(false);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingAnswer>>(new Map());
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Chips come from what this machine filter and device could show, so a
  // chip never leads to an empty feed.
  const chips = useMemo(() => {
    const reachable = buildOneFeed({
      threads: [],
      decisions: feed.entries,
      filter: {
        machine: filtered.filter.machine,
        ...(filtered.filter.device ? { device: filtered.filter.device } : {}),
      },
    }).flatMap((card) => (card.kind === "decision" ? [card.decision.item] : []));
    return filterChips(reachable);
  }, [feed.entries, filtered.filter.machine, filtered.filter.device]);
  // Answered items stay hidden until the next refresh drops them from the feed.
  const visible = useMemo(
    () =>
      filtered.entries.filter(
        (entry) => !pending.has(entryKey(entry)) && !sent.has(entryKey(entry)),
      ),
    [filtered.entries, pending, sent],
  );

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
      if (result._tag === "Success") setSent((current) => new Set(current).add(key));
    },
    [answerCommand],
  );

  useEffect(
    () => () => {
      for (const item of pendingRef.current.values()) clearTimeout(item.timer);
    },
    [],
  );

  const undo = (key: string) => {
    const item = pendingRef.current.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    setPending((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const answer = (entry: DecisionEntry, value: DecisionAnswerInput) => {
    const key = entryKey(entry);
    const timer = setTimeout(() => void send(key), UNDO_WINDOW_MS);
    setPending((current) => new Map(current).set(key, { entry, answer: value, timer }));
    toastManager.add({
      type: "success",
      title: entry.item.title || entry.item.question,
      description: answerSummary(entry.item, value),
      timeout: UNDO_WINDOW_MS,
      actionProps: { children: "Undo", onClick: () => undo(key) },
    });
    if (session) {
      const next = visible.find((candidate) => entryKey(candidate) !== key);
      setOpenKey(next ? entryKey(next) : null);
      if (!next) setSession(false);
    } else {
      setOpenKey(null);
    }
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
  const selectedBlurbs = projects.map((project) => ({
    project,
    description: blurbs.get(project)?.description ?? null,
  }));

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
                  onPrevious: () => {
                    const index = visible.indexOf(opened);
                    const previous = visible[index - 1] ?? visible.at(-1);
                    setOpenKey(previous ? entryKey(previous) : null);
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
                <ToggleGroup
                  value={[tab]}
                  onValueChange={(value) => setTab((value[0] as "open" | "answered") ?? "open")}
                >
                  <Toggle size="sm" value="open">
                    Open
                    {visible.length > 0 ? (
                      <Badge variant="secondary" size="sm">
                        {visible.length}
                      </Badge>
                    ) : null}
                  </Toggle>
                  <Toggle size="sm" value="answered">
                    Answered
                  </Toggle>
                </ToggleGroup>
                <div className="ml-auto">
                  <Button
                    size="sm"
                    disabled={tab !== "open" || visible.length === 0}
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
            {/* The page never scrolls sideways; only the chip row does. */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl min-w-0 space-y-3 px-4 py-4">
                {tab === "open" && chips.projects.length + chips.kinds.length > 1 ? (
                  <ChipRow
                    projects={chips.projects}
                    kinds={chips.kinds}
                    selectedProjects={projects}
                    selectedKinds={kinds}
                    blurbs={blurbs}
                    onProjects={setProjects}
                    onKinds={setKinds}
                  />
                ) : null}
                {tab === "open"
                  ? selectedBlurbs.map(({ project, description }) => (
                      <ProjectBlurbLine key={project} project={project} description={description} />
                    ))
                  : null}

                {tab === "answered" ? (
                  <AnsweredList feed={answered} now={now} />
                ) : feed.isPending ? (
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

                {tab === "open" && filtered.elsewhere > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {filtered.elsewhere} waiting on your{" "}
                    {filtered.filter.device === "phone" ? "desktop" : "phone"}
                  </p>
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

/**
 * Project and kind chips in one row that scrolls on its own, with fading
 * edges, inside the card column. Each project chip's tooltip says what the
 * project is.
 */
function ChipRow(props: {
  readonly projects: readonly string[];
  readonly kinds: readonly string[];
  readonly selectedProjects: readonly string[];
  readonly selectedKinds: readonly string[];
  readonly blurbs: ReadonlyMap<string, DecisionProjectBlurb>;
  readonly onProjects: (projects: string[]) => void;
  readonly onKinds: (kinds: string[]) => void;
}) {
  return (
    <div
      aria-label="Filters"
      className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ToggleGroup
        multiple
        className="shrink-0"
        value={[...props.selectedProjects]}
        onValueChange={(value) => props.onProjects(value as string[])}
      >
        {props.projects.map((project) => {
          const description = props.blurbs.get(project)?.description;
          return description ? (
            <Tooltip key={project}>
              <TooltipTrigger render={<Toggle size="sm" value={project} />}>
                {project}
              </TooltipTrigger>
              <TooltipPopup side="bottom" className="max-w-xs">
                {description}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <Toggle key={project} size="sm" value={project}>
              {project}
            </Toggle>
          );
        })}
      </ToggleGroup>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
      <ToggleGroup
        multiple
        className="shrink-0"
        value={[...props.selectedKinds]}
        onValueChange={(value) => props.onKinds(value as string[])}
      >
        {props.kinds.map((kind) => (
          <Toggle key={kind} size="sm" value={kind}>
            {kind}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** "courtroom: trial adventure…" under the chips, with the owner's own line editable. */
function ProjectBlurbLine({
  project,
  description,
}: {
  readonly project: string;
  readonly description: string | null;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const describe = useAtomCommand(decisionEnvironment.describeProject, "describe project");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const save = async () => {
    setEditing(false);
    if (environmentId === null || draft.trim() === (description ?? "")) return;
    await describe({ environmentId, input: { project, description: draft.trim() || null } });
  };
  return editing ? (
    <Input
      autoFocus
      size="sm"
      aria-label={`What ${project} is`}
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") void save();
        if (event.key === "Escape") setEditing(false);
      }}
    />
  ) : (
    <p className="group flex items-start gap-1.5 text-sm text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{project}</span>
        {description ? `: ${description}` : ": no description yet"}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Edit what ${project} is`}
        onClick={() => {
          setDraft(description ?? "");
          setEditing(true);
        }}
      >
        <PencilIcon />
      </Button>
    </p>
  );
}

/** Answered decisions: what was asked, the choice with its pictures, and the note. */
function AnsweredList({ feed, now }: { readonly feed: DecisionFeed; readonly now: number }) {
  if (feed.isPending) return <Skeleton className="h-28 w-full" />;
  if (feed.entries.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyTitle>No answers yet</EmptyTitle>
          <EmptyDescription>Decisions you answer show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return feed.entries.map((entry) => {
    const { item, answer } = entry;
    const chosen = item.options.filter((option) => answer?.option_ids?.includes(option.id));
    const pictures = chosen.flatMap((option) => {
      const media = option.media_idx === null ? undefined : item.media[option.media_idx];
      return media?.type === "image" ? [media] : [];
    });
    return (
      <article
        key={entryKey(entry)}
        className="space-y-2 rounded-lg border border-border bg-card p-4"
        data-decision-answered={item.kind}
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary" size="sm">
            {item.kind}
          </Badge>
          <span className="truncate">
            {item.project} · {entry.environmentLabel}
          </span>
          <span className="ml-auto shrink-0">
            {item.answered_at ? ageLabel(item.answered_at, now) : null}
          </span>
        </div>
        <h2 className="font-medium text-foreground">{item.title || item.question}</h2>
        {pictures.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {pictures.map((media) => (
              <DecisionMedia
                key={media.key}
                environmentId={entry.environmentId}
                media={media}
                framed
              />
            ))}
          </div>
        ) : null}
        {answer ? (
          <p className="text-sm text-foreground">
            <CheckIcon className="me-1 inline size-3.5 text-success-foreground" />
            {answerSummary(item, answer)}
          </p>
        ) : null}
        {answer?.comment ? (
          <p className="text-sm text-muted-foreground">“{answer.comment}”</p>
        ) : null}
        {item.thread ? (
          <Button
            size="xs"
            variant="outline"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: entry.environmentId, threadId: item.thread }}
              />
            }
          >
            Open thread
          </Button>
        ) : null}
      </article>
    );
  });
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
        {/* Agents often reuse one question across a batch; the title tells them apart. */}
        {item.title && item.title !== item.question ? (
          <>
            <h2 className="mt-1 font-medium text-foreground">{item.title}</h2>
            <p className="text-sm text-muted-foreground">{item.question}</p>
          </>
        ) : (
          <h2 className="mt-1 font-medium text-foreground">{item.question}</h2>
        )}
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
