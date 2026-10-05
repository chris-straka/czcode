import type {
  DecisionAnswerInput,
  DecisionMediaRef,
  DecisionMediaUploadQuery,
  DecisionRedline,
} from "@cz/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartIcon,
  MicIcon,
  RepeatIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UndoIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import type { DecisionEntry } from "~/state/decisions";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { DecisionMedia, useDecisionMediaUrl } from "./DecisionMedia";
import {
  type DecisionDraft,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  VERDICT_BUTTONS,
} from "@cz/client-runtime/decisions/draft";

export type UploadDecisionMedia = (
  meta: DecisionMediaUploadQuery,
  bytes: Uint8Array,
) => Promise<DecisionMediaRef | null>;

interface DecisionViewProps {
  readonly entry: DecisionEntry;
  readonly position?: { readonly index: number; readonly total: number };
  readonly onSubmit: (answer: DecisionAnswerInput) => void;
  readonly onUpload: UploadDecisionMedia;
  readonly onClose: () => void;
  readonly onSkip?: () => void;
}

/** One decision, full screen, with its answer panel pinned to the bottom. */
export function DecisionView({
  entry,
  position,
  onSubmit,
  onUpload,
  onClose,
  onSkip,
}: DecisionViewProps) {
  const { item, environmentId } = entry;
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDraft(item));
  const update = (patch: Partial<DecisionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const problem = draftProblem(item, draft);
  const verdicts = VERDICT_BUTTONS[item.kind];
  const submit = (patch: Partial<DecisionDraft> = {}, retry = false) =>
    onSubmit(draftToAnswer(item, { ...draft, ...patch }, retry));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-decision-kind={item.kind}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" size="sm">
              {item.kind}
            </Badge>
            <span>{item.project}</span>
            <span>· {entry.environmentLabel}</span>
            {item.blocking ? (
              <Badge variant="warning" size="sm">
                Agent waiting
              </Badge>
            ) : null}
            {position ? (
              <span className="ml-auto">
                {position.index + 1} of {position.total}
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{item.question}</h1>
          {item.cost_note ? (
            <p className="mt-1 text-sm text-warning-foreground">{item.cost_note}</p>
          ) : null}
        </div>
        {onSkip ? (
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip
            <ChevronRightIcon />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {item.kind !== "read" && item.body_md ? (
          <ChatMarkdown text={item.body_md} cwd={undefined} environmentId={environmentId} />
        ) : null}
        <UploadContext value={onUpload}>
          <DecisionBody entry={entry} draft={draft} update={update} />
        </UploadContext>
      </div>

      <footer className="sticky bottom-0 space-y-2 border-t border-border bg-background px-4 py-3">
        <div className="flex items-start gap-2">
          <Textarea
            aria-label="Note"
            placeholder={
              item.kind === "request"
                ? "Write it here, or attach or record it"
                : "Add a note (optional)"
            }
            value={draft.comment}
            onChange={(event) => update({ comment: event.target.value })}
            className="min-h-10 flex-1"
          />
          <VoiceNoteButton
            recorded={draft.voiceKey !== null}
            onRecorded={async (bytes, mime) => {
              const ref = await onUpload({ name: "voice-note.webm", mime, type: "voice" }, bytes);
              if (ref) update({ voiceKey: ref.key });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {verdicts ? (
            verdicts.map((verdict) => (
              <Button
                key={verdict.value}
                variant={
                  verdict.value === "reject" || verdict.value === "never" ? "outline" : "default"
                }
                onClick={() => submit({ choice: verdict.value })}
              >
                {verdict.label}
              </Button>
            ))
          ) : item.kind === "timeline" ? (
            <>
              <Button onClick={() => submit({ choice: "approve", redoFrom: null })}>
                Approve run
              </Button>
              <Button
                variant="outline"
                disabled={draft.redoFrom === null}
                onClick={() => submit({ choice: "redo" })}
              >
                Redo from {stepLabel(entry, draft.redoFrom) ?? "a step"}
              </Button>
            </>
          ) : (
            <Button
              disabled={problem !== null}
              title={problem ?? undefined}
              onClick={() => submit()}
            >
              Send
            </Button>
          )}
          {item.options.length > 0 && item.kind !== "rank" ? (
            <Button
              variant="ghost"
              disabled={!draft.comment.trim() && draft.voiceKey === null}
              title="Needs a note saying what to try instead"
              onClick={() => submit({}, true)}
            >
              <RepeatIcon />
              None of these, try again
            </Button>
          ) : null}
          {problem && !verdicts && item.kind !== "timeline" ? (
            <span className="text-xs text-muted-foreground">{problem}</span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

function stepLabel(entry: DecisionEntry, id: string | null): string | null {
  return entry.item.steps.find((step) => step.id === id)?.label ?? null;
}

interface BodyProps {
  readonly entry: DecisionEntry;
  readonly draft: DecisionDraft;
  readonly update: (patch: Partial<DecisionDraft>) => void;
}

function DecisionBody(props: BodyProps) {
  const { entry } = props;
  switch (entry.item.kind) {
    case "pick":
      return <PickBody {...props} />;
    case "rank":
      return <RankBody {...props} />;
    case "listen":
      return <ListenBody {...props} />;
    case "review":
      return <ReviewBody {...props} />;
    case "read":
      return <ReadBody {...props} />;
    case "playtest":
      return <PlaytestBody {...props} />;
    case "request":
      return <RequestBody {...props} />;
    case "timeline":
      return <TimelineBody {...props} />;
    default:
      return <MediaList entry={entry} />;
  }
}

function MediaList({ entry }: { entry: DecisionEntry }) {
  const glbs = entry.item.media.filter((media) => media.type === "glb");
  return (
    <div className={cn("grid gap-3", glbs.length === 2 && "md:grid-cols-2")}>
      {entry.item.media.map((media) => (
        <figure key={media.key} className="space-y-1">
          <DecisionMedia environmentId={entry.environmentId} media={media} />
          {media.caption ? (
            <figcaption className="text-xs text-muted-foreground">{media.caption}</figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

function PickBody({ entry, draft, update }: BodyProps) {
  const { item } = entry;
  const toggle = (id: string) => {
    if (item.max_choices === 1) return update({ optionIds: [id] });
    update({
      optionIds: draft.optionIds.includes(id)
        ? draft.optionIds.filter((value) => value !== id)
        : [...draft.optionIds, id],
    });
  };
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3"
      role="listbox"
      aria-multiselectable={item.max_choices > 1}
    >
      {item.options.map((option) => {
        const media = option.media_idx === null ? null : item.media[option.media_idx];
        const selected = draft.optionIds.includes(option.id);
        return (
          <div
            key={option.id}
            role="option"
            tabIndex={0}
            aria-selected={selected}
            aria-label={option.label}
            // Players inside the tile keep their own clicks; anywhere else selects it.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("audio,video,model-viewer")) return;
              toggle(option.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle(option.id);
              }
            }}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary ring-2 ring-primary" : "border-border",
            )}
          >
            {media ? <DecisionMedia environmentId={entry.environmentId} media={media} /> : null}
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {option.label}
              {option.recommended ? (
                <Badge variant="info" size="sm">
                  Recommended
                </Badge>
              ) : null}
            </span>
            {option.reason ? (
              <span className="text-xs text-muted-foreground">{option.reason}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RankBody({ entry, draft, update }: BodyProps) {
  const label = (id: string) => entry.item.options.find((option) => option.id === id)?.label ?? id;
  const move = (index: number, delta: number) => {
    const next = [...draft.rank];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    update({ rank: next });
  };
  const [dragging, setDragging] = useState<number | null>(null);
  return (
    <ol className="space-y-2">
      {draft.rank.map((id, index) => (
        <li
          key={id}
          draggable
          onDragStart={() => setDragging(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragging === null || dragging === index) return;
            const next = [...draft.rank];
            const [moved] = next.splice(dragging, 1);
            next.splice(index, 0, moved!);
            update({ rank: next });
            setDragging(null);
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
        >
          <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
          <span className="flex-1 text-sm">{label(id)}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move up"
            onClick={() => move(index, -1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move down"
            onClick={() => move(index, 1)}
          >
            <ArrowDownIcon />
          </Button>
        </li>
      ))}
    </ol>
  );
}

function ListenBody({ entry, draft, update }: BodyProps) {
  const { item } = entry;
  const context = item.context_media_idx === null ? null : item.media[item.context_media_idx];
  const contextUrl = useDecisionMediaUrl(entry.environmentId, context);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setReaction = (
    optionId: string,
    patch: { verdict?: "keep" | "kill" | "favourite" | null; note?: string },
  ) => {
    const current = draft.reactions[optionId] ?? { option_id: optionId, verdict: null };
    update({ reactions: { ...draft.reactions, [optionId]: { ...current, ...patch } } });
  };
  return (
    <div className="space-y-3">
      {contextUrl ? (
        <video
          ref={videoRef}
          src={contextUrl}
          muted
          playsInline
          controls
          className="w-full rounded-md bg-black"
        />
      ) : null}
      {item.options.map((option) => {
        const reaction = draft.reactions[option.id];
        const media = option.media_idx === null ? null : item.media[option.media_idx];
        const verdictButton = (
          verdict: "keep" | "kill" | "favourite",
          icon: ReactNode,
          label: string,
        ) => (
          <Button
            size="icon-sm"
            variant={reaction?.verdict === verdict ? "secondary" : "ghost"}
            aria-label={label}
            aria-pressed={reaction?.verdict === verdict}
            onClick={() =>
              setReaction(option.id, { verdict: reaction?.verdict === verdict ? null : verdict })
            }
          >
            {icon}
          </Button>
        );
        return (
          <div
            key={option.id}
            className="space-y-2 rounded-lg border border-border p-3"
            data-listen-row={option.id}
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium">
                {option.label}
                {option.recommended ? (
                  <span className="ml-2 text-xs text-info-foreground">recommended</span>
                ) : null}
              </span>
              {verdictButton("keep", <ThumbsUpIcon />, "Keep")}
              {verdictButton("kill", <ThumbsDownIcon />, "Kill")}
              {verdictButton("favourite", <HeartIcon />, "Favourite")}
            </div>
            {media ? (
              <ListenPlayer
                environmentId={entry.environmentId}
                media={media}
                onPlay={() => {
                  const video = videoRef.current;
                  if (video) {
                    video.currentTime = 0;
                    void video.play();
                  }
                }}
              />
            ) : null}
            <Input
              aria-label={`Note on ${option.label}`}
              placeholder="Note (“too retro”, “more metal”)"
              value={reaction?.note ?? ""}
              onChange={(event) => setReaction(option.id, { note: event.target.value })}
            />
          </div>
        );
      })}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.moreLikeThese}
          onChange={(event) => update({ moreLikeThese: event.target.checked })}
        />
        More like the kept ones
      </label>
    </div>
  );
}

function ListenPlayer({
  environmentId,
  media,
  onPlay,
}: {
  environmentId: DecisionEntry["environmentId"];
  media: DecisionMediaRef;
  onPlay: () => void;
}) {
  const url = useDecisionMediaUrl(environmentId, media);
  const [loop, setLoop] = useState(false);
  if (!url) return null;
  return (
    <div className="flex items-center gap-2">
      <audio controls preload="none" loop={loop} src={url} onPlay={onPlay} className="h-9 flex-1" />
      <Button
        size="icon-sm"
        variant={loop ? "secondary" : "ghost"}
        aria-label="Loop"
        aria-pressed={loop}
        onClick={() => setLoop((value) => !value)}
      >
        <RepeatIcon />
      </Button>
    </div>
  );
}

function ReviewBody({ entry, draft, update }: BodyProps) {
  return (
    <div className="space-y-3">
      {entry.item.media.map((media, index) =>
        media.type === "image" ? (
          <RedlineImage
            key={media.key}
            entry={entry}
            media={media}
            strokes={draft.redlines.filter((stroke) => stroke.media_idx === index)}
            onStroke={(points) =>
              update({ redlines: [...draft.redlines, { media_idx: index, points }] })
            }
            onUndo={() => {
              const last = draft.redlines.findLastIndex((stroke) => stroke.media_idx === index);
              if (last >= 0) update({ redlines: draft.redlines.filter((_, i) => i !== last) });
            }}
          />
        ) : (
          <DecisionMedia key={media.key} environmentId={entry.environmentId} media={media} />
        ),
      )}
    </div>
  );
}

/** An image the owner can draw on; strokes are stored in 0..1 image coordinates. */
function RedlineImage({
  entry,
  media,
  strokes,
  onStroke,
  onUndo,
}: {
  entry: DecisionEntry;
  media: DecisionMediaRef;
  strokes: readonly DecisionRedline[];
  onStroke: (points: Array<[number, number]>) => void;
  onUndo: () => void;
}) {
  const url = useDecisionMediaUrl(entry.environmentId, media);
  const [current, setCurrent] = useState<Array<[number, number]> | null>(null);
  const point = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };
  const path = (points: ReadonlyArray<readonly [number, number]>) =>
    points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x * 1000} ${y * 1000}`).join(" ");
  if (!url) return <div className="h-48 rounded-md bg-muted" />;
  return (
    <figure className="space-y-1">
      <div className="relative">
        <img
          src={url}
          alt={media.caption ?? media.name}
          className="w-full rounded-md"
          draggable={false}
        />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full touch-none text-destructive"
          aria-label="Draw on the image"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setCurrent([point(event)]);
          }}
          onPointerMove={(event) => current && setCurrent([...current, point(event)])}
          onPointerUp={() => {
            if (current && current.length > 1) onStroke(current);
            setCurrent(null);
          }}
        >
          {[...strokes.map((stroke) => stroke.points), ...(current ? [current] : [])].map(
            (points) => (
              <path
                key={path(points)}
                d={path(points)}
                fill="none"
                stroke="currentColor"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
        </svg>
      </div>
      <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex-1">Draw to mark what to change.</span>
        {strokes.length > 0 ? (
          <Button size="xs" variant="ghost" onClick={onUndo}>
            <UndoIcon />
            Undo stroke
          </Button>
        ) : null}
      </figcaption>
    </figure>
  );
}

function ReadBody({ entry, draft, update }: BodyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const body = entry.item.body_md;
  const capture = () => {
    const text = window.getSelection()?.toString().trim() ?? "";
    setSelection(text.length > 0 ? text : null);
  };
  const addComment = () => {
    if (!selection || !note.trim()) return;
    const start = Math.max(0, body.indexOf(selection));
    update({
      passageComments: [
        ...draft.passageComments,
        { start, end: start + selection.length, quote: selection, note: note.trim() },
      ],
    });
    setSelection(null);
    setNote("");
  };
  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        onMouseUp={capture}
        onTouchEnd={capture}
        className="rounded-lg border border-border p-4"
      >
        <ChatMarkdown text={body} cwd={undefined} environmentId={entry.environmentId} />
      </div>
      {selection ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <blockquote className="border-l-2 border-primary pl-2 text-sm italic">
            {selection}
          </blockquote>
          <div className="flex gap-2">
            <Input
              aria-label="Comment on the selection"
              placeholder="Comment on this passage"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button disabled={!note.trim()} onClick={addComment}>
              Add
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Select a passage to comment on it.</p>
      )}
      {draft.passageComments.map((comment, index) => (
        <div
          key={`${comment.start}:${comment.quote}:${comment.note}`}
          className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"
        >
          <div className="flex-1">
            <p className="italic text-muted-foreground">“{comment.quote}”</p>
            <p>{comment.note}</p>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Remove comment"
            onClick={() =>
              update({ passageComments: draft.passageComments.filter((_, i) => i !== index) })
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function PlaytestBody({ entry, draft, update }: BodyProps) {
  const field = (key: keyof DecisionDraft["playtest"], label: string) => (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <Textarea
        value={draft.playtest[key]}
        onChange={(event) => update({ playtest: { ...draft.playtest, [key]: event.target.value } })}
      />
    </label>
  );
  return (
    <div className="space-y-3">
      <MediaList entry={entry} />
      {field("good", "What felt good")}
      {field("bad", "What felt bad")}
      {field("bugs", "Bugs")}
    </div>
  );
}

function RequestBody({ entry, draft, update }: BodyProps) {
  return (
    <div className="space-y-3">
      <MediaList entry={entry} />
      <RequestUploads draft={draft} update={update} />
    </div>
  );
}

function RequestUploads({ draft, update }: Omit<BodyProps, "entry">) {
  const upload = useContext(UploadContext);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <label className="inline-flex">
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            if (!upload || files.length === 0) return;
            setBusy(true);
            const refs: DecisionMediaRef[] = [];
            for (const file of files) {
              const ref = await upload(
                {
                  name: file.name,
                  mime: file.type || "application/octet-stream",
                  type: file.type.startsWith("image/")
                    ? "image"
                    : file.type.startsWith("audio/")
                      ? "audio"
                      : file.type.startsWith("video/")
                        ? "video"
                        : "file",
                },
                new Uint8Array(await file.arrayBuffer()),
              );
              if (ref) refs.push(ref);
            }
            update({ uploads: [...draft.uploads, ...refs] });
            setBusy(false);
          }}
        />
        <span
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm",
            busy && "opacity-60",
          )}
        >
          <UploadIcon className="size-4" />
          {busy ? "Uploading…" : "Attach files"}
        </span>
      </label>
      {draft.uploads.map((ref) => (
        <div key={ref.key} className="text-sm text-muted-foreground">
          {ref.name}
        </div>
      ))}
    </div>
  );
}

/** Uploads for the decision being answered (owner files for Request). */
const UploadContext = createContext<UploadDecisionMedia | null>(null);

function TimelineBody({ entry, draft, update }: BodyProps) {
  const { item } = entry;
  const [selected, setSelected] = useState(item.steps[0]?.id ?? null);
  const step = item.steps.find((candidate) => candidate.id === selected) ?? null;
  const media = step?.media_idx == null ? null : item.media[step.media_idx];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {item.steps.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === selected}
            onClick={() => setSelected(candidate.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm",
              candidate.id === selected ? "border-primary" : "border-border",
              candidate.status === "failed" && "text-destructive-foreground",
              candidate.id === draft.redoFrom && "bg-warning/20",
            )}
          >
            <span className="text-xs text-muted-foreground">{index + 1}</span>
            {candidate.label}
          </button>
        ))}
      </div>
      {media ? <DecisionMedia environmentId={entry.environmentId} media={media} /> : null}
      {step ? (
        <Button
          variant={draft.redoFrom === step.id ? "secondary" : "outline"}
          onClick={() =>
            update({ redoFrom: draft.redoFrom === step.id ? null : step.id, choice: "redo" })
          }
        >
          <ChevronLeftIcon />
          {draft.redoFrom === step.id ? "Redo from here (selected)" : "Redo from here"}
        </Button>
      ) : null}
    </div>
  );
}

/** Records a voice note with the microphone and hands back its bytes. */
function VoiceNoteButton({
  recorded,
  onRecorded,
}: {
  recorded: boolean;
  onRecorded: (bytes: Uint8Array, mime: string) => void | Promise<void>;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: media.mimeType });
      await onRecorded(new Uint8Array(await blob.arrayBuffer()), media.mimeType || "audio/webm");
    };
    media.start();
    recorder.current = media;
    setRecording(true);
  };
  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
  };
  return (
    <Button
      size="icon"
      variant={recording ? "destructive" : recorded ? "secondary" : "outline"}
      aria-label={
        recording ? "Stop recording" : recorded ? "Voice note recorded" : "Record a voice note"
      }
      onClick={() => (recording ? stop() : void start())}
    >
      {recording ? <SquareIcon /> : <MicIcon />}
    </Button>
  );
}
