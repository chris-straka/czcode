import {
  answerSummary,
  canAnswerFromCard,
  VERDICT_BUTTONS,
} from "@cz/client-runtime/decisions/draft";
import { filterChips } from "@cz/client-runtime/decisions/feed";
import { buildOneFeed, feedFolderLabel } from "@cz/client-runtime/decisions/oneFeed";
import type { EnvironmentThreadShell } from "@cz/client-runtime/state/models";
import type { DecisionAnswerInput, DecisionMediaRef, DecisionProjectBlurb } from "@cz/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { CheckIcon, InboxIcon, PencilIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFeedFilterStore } from "~/feedFilterStore";
import { cn } from "~/lib/utils";
import {
  type DecisionEntry,
  type DecisionFeed,
  decisionEnvironment,
  useAnsweredDecisions,
  useFilteredOpenDecisions,
  useOpenDecisions,
  useProjectBlurbs,
  useThreadDigests,
} from "~/state/decisions";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { DECISION_OPTION_FRAME_CLASS, DecisionMedia } from "../decisions/DecisionMedia";
import { DecisionView, type UploadDecisionMedia } from "../decisions/DecisionView";
import { NoProjectsHero } from "../NoProjectsHero";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FeedModal } from "./FeedModal";
import { FeedMeta, FeedThreadCard, FeedThreadRow, feedThreadStatus } from "./FeedThreadCard";
import { FeedTopBar } from "./FeedTopBar";

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

/** How many thread digests (result excerpt, folder) the feed reads at once. */
const DIGEST_PAGE = 60;
/** Thread rows shown at first and per "Show more"; the list can run to hundreds. */
const ROW_PAGE = 40;

/**
 * The one feed (layout A): a slim top bar, then one column. Threads and
 * decisions merge: a thread's decisions ride on its card, decisions from
 * outside a thread get their own card, and cards that need the owner come
 * first. Finished and running threads follow as compact rows. Everything
 * else (a thread, settings, a decision) opens in a modal over it.
 */
export function FeedPage() {
  const navigate = useNavigate();
  const feed = useOpenDecisions();
  const filtered = useFilteredOpenDecisions();
  const answered = useAnsweredDecisions();
  const blurbs = useProjectBlurbs();
  const threads = useThreadShells();
  const projects = useProjects();
  const { presentationById } = useEnvironments();
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const uploadCommand = useAtomCommand(decisionEnvironment.upload, "upload decision media");
  const selectedProjects = useFeedFilterStore((state) => state.projects);
  const kinds = useFeedFilterStore((state) => state.kinds);
  const setProjects = useFeedFilterStore((state) => state.setProjects);
  const setKinds = useFeedFilterStore((state) => state.setKinds);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
  const location = useLocation({
    select: (value) => ({ pathname: value.pathname, search: value.search }),
  });
  const searchOpen =
    location.pathname === "/decisions" && typeof location.search.open === "string"
      ? location.search.open
      : null;
  const [openKey, setOpenKey] = useState<string | null>(searchOpen);
  useEffect(() => {
    if (searchOpen) setOpenKey(searchOpen);
  }, [searchOpen]);
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

  const machineLabel = (environmentId: string) =>
    presentationById.get(environmentId as never)?.entry.target.label ?? "";
  const projectById = useMemo(
    () =>
      new Map(
        projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
      ),
    [projects],
  );

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
  const cards = useMemo(
    () =>
      buildOneFeed({
        threads,
        decisions: feed.entries.filter(
          (entry) => !pending.has(entryKey(entry)) && !sent.has(entryKey(entry)),
        ),
        filter: filtered.filter,
      }),
    [threads, feed.entries, filtered.filter, pending, sent],
  );
  const needsYou = cards.filter((card) => card.needsYou);
  const rest = cards.filter((card) => !card.needsYou);
  const rows = rest.slice(0, rowLimit);
  const shownThreads = [...needsYou, ...rows]
    .flatMap((card) => (card.kind === "thread" ? [card.thread] : []))
    .slice(0, DIGEST_PAGE);
  const digests = useThreadDigests(shownThreads);

  // Decisions in feed order, for Review all and the modal's position.
  const visible = useMemo(
    () => cards.flatMap((card) => (card.kind === "decision" ? [card.decision] : card.decisions)),
    [cards],
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

  const closeDecision = () => {
    setOpenKey(null);
    setSession(false);
    if (location.pathname === "/decisions") void navigate({ to: "/", replace: true });
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
      if (!next) closeDecision();
    } else {
      closeDecision();
    }
  };
  const quickAnswer = (entry: DecisionEntry, patch: Partial<DecisionAnswerInput>) =>
    answer(entry, {
      choice: null,
      option_ids: null,
      rank: null,
      comment: null,
      voice_key: null,
      ...patch,
    });

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
  const selectedBlurbs = selectedProjects.map((project) => ({
    project,
    description: blurbs.get(project)?.description ?? null,
  }));

  const threadPlacement = (thread: EnvironmentThreadShell) => {
    const project = projectById.get(`${thread.environmentId}:${thread.projectId}`);
    const digest = digests.get(`${thread.environmentId}:${thread.id}`);
    return {
      machine: machineLabel(thread.environmentId),
      folder: feedFolderLabel(project?.title ?? "", digest?.workingSubpath),
      excerpt: digest?.excerpt ?? null,
      age: ageLabel(Date.parse(thread.updatedAt), now),
    };
  };
  const decisionCard = (entry: DecisionEntry, embedded = false) => (
    <DecisionCard
      key={entryKey(entry)}
      entry={entry}
      embedded={embedded}
      age={ageLabel(entry.item.created_at, now)}
      onOpen={() => setOpenKey(entryKey(entry))}
      onQuickAnswer={(patch) => quickAnswer(entry, patch)}
    />
  );

  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col bg-background" data-feed-page="">
      <FeedTopBar
        badge={filtered.entries.length}
        reviewing={visible.length > 0}
        onReviewAll={() => {
          setSession(true);
          setOpenKey(visible[0] ? entryKey(visible[0]) : null);
        }}
      />
      {/* The page never scrolls sideways; only the chip row does. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl min-w-0 space-y-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <ToggleGroup
              value={[tab]}
              onValueChange={(value) => setTab((value[0] as "open" | "answered") ?? "open")}
            >
              <Toggle size="sm" value="open">
                Feed
              </Toggle>
              <Toggle size="sm" value="answered">
                Answered
              </Toggle>
            </ToggleGroup>
          </div>
          {tab === "open" && chips.projects.length + chips.kinds.length > 1 ? (
            <ChipRow
              projects={chips.projects}
              kinds={chips.kinds}
              selectedProjects={selectedProjects}
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
          ) : feed.isPending && threads.length === 0 ? (
            <>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </>
          ) : cards.length === 0 && pending.size === 0 ? (
            projects.length === 0 ? (
              <NoProjectsHero />
            ) : (
              <Empty className="min-h-64">
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>All clear</EmptyTitle>
                  <EmptyDescription>Threads and agents' questions show up here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : (
            <>
              {needsYou.length > 0 ? (
                <h2 className="pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Needs you <span className="text-warning-foreground">{needsYou.length}</span>
                </h2>
              ) : null}
              {needsYou.map((card) => {
                if (card.kind === "decision") return decisionCard(card.decision);
                const placement = threadPlacement(card.thread);
                return (
                  <FeedThreadCard
                    key={card.key}
                    thread={card.thread}
                    {...placement}
                    status="needs-you"
                  >
                    {card.decisions.length > 0
                      ? card.decisions.map((entry) => decisionCard(entry, true))
                      : null}
                  </FeedThreadCard>
                );
              })}
              {rest.length > 0 ? (
                <>
                  <h2 className="pt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Threads
                  </h2>
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {rows.flatMap((card) =>
                      card.kind === "thread"
                        ? [
                            <FeedThreadRow
                              key={card.key}
                              thread={card.thread}
                              {...threadPlacement(card.thread)}
                              status={feedThreadStatus(card.thread, false)}
                            />,
                          ]
                        : [],
                    )}
                  </div>
                </>
              ) : null}
              {rest.length > rowLimit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setRowLimit((limit) => limit + ROW_PAGE)}
                >
                  Show {Math.min(ROW_PAGE, rest.length - rowLimit)} more
                </Button>
              ) : null}
            </>
          )}

          {feed.unreachable.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Couldn't reach {feed.unreachable.join(", ")}; their decisions show up when they're
              back.
            </p>
          ) : null}
        </div>
      </div>
      {opened && upload ? (
        <FeedModal
          label={opened.item.title || opened.item.question}
          onClose={closeDecision}
          showClose={false}
        >
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
            onClose={closeDecision}
          />
        </FeedModal>
      ) : null}
    </div>
  );
}

/** A row of chips that scrolls on its own with faded edges, inside the card column. */
function ScrollingChips({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      aria-label={label}
      className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );
}

/**
 * Project chips in two sections, Games and Software (grouped by where each
 * project's folder lives), each led by a toggle that picks the whole group;
 * then decision kinds. A project chip's tooltip says what the project is.
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
  const groups = (["games", "software"] as const)
    .map((group) => ({
      group,
      label: group === "games" ? "Games" : "Software",
      projects: props.projects.filter(
        (project) => (props.blurbs.get(project)?.group ?? "software") === group,
      ),
    }))
    .filter((section) => section.projects.length > 0);
  const selected = new Set(props.selectedProjects);
  return (
    <div className="space-y-2" aria-label="Filters">
      {groups.map((section) => {
        const all = section.projects.every((project) => selected.has(project));
        return (
          <ScrollingChips key={section.group} label={`${section.label} projects`}>
            <Toggle
              size="sm"
              variant="outline"
              className="shrink-0"
              pressed={all}
              aria-label={`All ${section.label.toLowerCase()} projects`}
              onPressedChange={(pressed) =>
                props.onProjects(
                  pressed
                    ? [...new Set([...props.selectedProjects, ...section.projects])]
                    : props.selectedProjects.filter(
                        (project) => !section.projects.includes(project),
                      ),
                )
              }
            >
              {section.label}
            </Toggle>
            <ToggleGroup
              multiple
              className="shrink-0"
              value={section.projects.filter((project) => selected.has(project))}
              onValueChange={(value) =>
                props.onProjects([
                  ...props.selectedProjects.filter(
                    (project) => !section.projects.includes(project),
                  ),
                  ...(value as string[]),
                ])
              }
            >
              {section.projects.map((project) => {
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
          </ScrollingChips>
        );
      })}
      {props.kinds.length > 1 ? (
        <ScrollingChips label="Kinds">
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
        </ScrollingChips>
      ) : null}
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

/**
 * A decision as a feed card, shaped by its kind so most never need opening:
 * a single-choice pick answers from its option tiles or buttons, review and
 * pitch from their verdict buttons, a playtest installs from the card.
 * `embedded` drops the frame for a decision riding on its thread's card.
 */
function DecisionCard({
  entry,
  age,
  embedded = false,
  onOpen,
  onQuickAnswer,
}: {
  entry: DecisionEntry;
  age: string;
  embedded?: boolean;
  onOpen: () => void;
  onQuickAnswer: (patch: Partial<DecisionAnswerInput>) => void;
}) {
  const { item } = entry;
  // A card answers in place only when nothing on it needs watching, hearing,
  // or installing first; otherwise it offers Open.
  const quick =
    (item.kind === "review" || item.kind === "pitch") && canAnswerFromCard(item)
      ? VERDICT_BUTTONS[item.kind]
      : null;
  const mediaOf = (option: (typeof item.options)[number]) =>
    option.media_idx === null ? undefined : item.media[option.media_idx];
  // Only single-choice picks answer from the card; the rest open the full view.
  const inlinePick = item.kind === "pick" && item.max_choices === 1 && item.options.length > 0;
  const pictures = inlinePick && item.options.some((option) => mediaOf(option)?.type === "image");
  const apk =
    item.kind === "playtest" ? item.media.find((media) => media.type === "apk") : undefined;
  return (
    <article
      className={cn(
        "space-y-3",
        embedded
          ? "border-t border-border pt-3"
          : "rounded-lg border border-warning/40 bg-card p-4",
      )}
      data-decision-card={item.kind}
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="flex items-center gap-1.5">
          {embedded ? null : (
            <FeedMeta machine={entry.environmentLabel} folder={item.project} model={null} />
          )}
          <Badge variant="secondary" size="sm">
            {item.kind}
          </Badge>
          {item.blocking ? (
            <Badge variant="warning" size="sm">
              Agent waiting
            </Badge>
          ) : null}
          {embedded ? null : (
            <span className="ms-auto shrink-0 text-xs text-muted-foreground">{age}</span>
          )}
        </div>
        <h3
          className={cn("mt-1 text-foreground", embedded ? "text-sm font-medium" : "font-medium")}
        >
          {embedded ? item.question : item.title || item.question}
        </h3>
        {!embedded && item.title && item.title !== item.question ? (
          <p className="text-sm text-muted-foreground">{item.question}</p>
        ) : null}
        {item.cost_note ? (
          <p className="text-xs text-warning-foreground">{item.cost_note}</p>
        ) : null}
      </button>
      {inlinePick ? (
        pictures ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {item.options.map((option) => {
              const media = mediaOf(option);
              return (
                <button
                  key={option.id}
                  type="button"
                  className="space-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onQuickAnswer({ option_ids: [option.id] })}
                  aria-label={`Pick ${option.label}`}
                >
                  {media ? (
                    <DecisionMedia environmentId={entry.environmentId} media={media} framed />
                  ) : (
                    <span
                      className={cn(
                        DECISION_OPTION_FRAME_CLASS,
                        "flex items-center justify-center p-2 text-center text-sm",
                      )}
                    >
                      {option.label}
                    </span>
                  )}
                  {media ? (
                    <span className="line-clamp-2 text-xs text-foreground">
                      {option.label}
                      {option.recommended ? " ★" : ""}
                    </span>
                  ) : option.recommended ? (
                    <span className="text-xs text-foreground">★ recommended</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {item.options.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="outline"
                onClick={() => onQuickAnswer({ option_ids: [option.id] })}
              >
                {option.label}
                {option.recommended ? " ★" : ""}
              </Button>
            ))}
          </div>
        )
      ) : null}
      {quick || apk ? (
        <div className="flex flex-wrap gap-2">
          {apk ? <DecisionMedia environmentId={entry.environmentId} media={apk} /> : null}
          {quick?.map((button) => (
            <Button
              key={button.value}
              size="sm"
              variant={button.value === "approve" || button.value === "yes" ? "default" : "outline"}
              onClick={() =>
                button.value === "changes" ? onOpen() : onQuickAnswer({ choice: button.value })
              }
            >
              {button.label}
            </Button>
          ))}
        </div>
      ) : null}
      {inlinePick || quick ? null : (
        <Button size="sm" variant="outline" onClick={onOpen}>
          Open
        </Button>
      )}
    </article>
  );
}
