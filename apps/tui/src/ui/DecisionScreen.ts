import {
  answerSummary,
  type DecisionDraft,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  VERDICT_BUTTONS,
} from "@cz/client-runtime/decisions/draft";
import type { DecisionMediaRef } from "@cz/contracts";
import { Box, Text } from "ink";
import { createElement as h, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type * as NodeChildProcess from "node:child_process";

import { type DecisionEntry, KIND_TAG } from "../model/decisionFeed.ts";
import {
  addPassageComment,
  moveRank,
  paragraphRanges,
  react,
  togglePick,
} from "../model/decisionDraft.ts";
import { adbInstall, openInF3d, openWithSystem, play, TURNTABLE_FRAMES } from "../model/media.ts";
import { tileGrid } from "../model/decisionTiles.ts";
import { READING_WIDTH, wrapText } from "../model/wrap.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { useViewport } from "./hooks.ts";
import { LETTERBOX } from "./InlineImage.ts";
import { MediaView } from "./MediaView.ts";
import { TextInput } from "./TextInput.ts";
import { useKeys, useVimMotion } from "./input.ts";

type Typing =
  | { readonly field: "comment" }
  | { readonly field: "good" | "bad" | "bugs" }
  | { readonly field: "passage"; readonly paragraph: number };

const PLAYTEST_LABEL = { good: "What felt good", bad: "What felt bad", bugs: "Bugs" } as const;

/**
 * One decision, answered from the keyboard. Every kind shares: j/k scroll,
 * 1-9 pick an option (or a verdict), ]/[ move between options, Enter send,
 * c note, N "none of these" (asks for new options), n/p (or J/K) next/previous decision,
 * o open the focused media full screen, t open the thread, Esc or q back.
 * Kinds add: pick 1-9 toggles · rank </> move · listen space play, y keep,
 * x kill, f favourite, l loop, m more · look ←→ turn, C clay · read p comment
 * on a paragraph · playtest i install, g/b/u fields · timeline a approve,
 * r redo from here.
 */
export function DecisionScreen(props: {
  readonly atoms: TuiAtoms;
  readonly entry: DecisionEntry;
  readonly active: boolean;
  /** Back to the feed; `answered` when the answer was sent. */
  readonly onDone: (answered: boolean) => void;
  /** Moves to the next (+1) or previous (-1) decision in the feed. */
  readonly onStep: (direction: 1 | -1) => void;
  readonly onOpenThread: (threadId: string) => void;
  /** "3/7" while reviewing the feed in order. */
  readonly position: string;
}) {
  const { atoms, entry } = props;
  const item = entry.item;
  const setStatus = useContext(StatusContext);
  const answer = useCommand(atoms.decisions.answer);
  const { rows: height, columns } = useViewport();
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDraft(item));
  const [cursor, setCursor] = useState(0);
  const [mediaIndex, setMediaIndex] = useState(item.context_media_idx ?? 0);
  const [frame, setFrame] = useState(0);
  const [clay, setClay] = useState(false);
  const [loop, setLoop] = useState(false);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [text, setText] = useState("");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const player = useRef<NodeChildProcess.ChildProcess | null>(null);

  const stop = () => {
    player.current?.kill();
    player.current = null;
    setPlayingKey(null);
  };
  useEffect(() => stop, []);

  const paragraphs = item.kind === "read" ? paragraphRanges(item.body_md) : [];
  const rows: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly media: number | null;
  }> =
    item.kind === "rank"
      ? draft.rank.map((id) => ({
          id,
          label: item.options.find((option) => option.id === id)?.label ?? id,
          media: item.options.find((option) => option.id === id)?.media_idx ?? null,
        }))
      : item.kind === "timeline"
        ? item.steps.map((step) => ({
            id: step.id,
            label: `${step.label} (${step.status})`,
            media: step.media_idx,
          }))
        : item.kind === "read"
          ? paragraphs.map((range, index) => ({
              id: String(index),
              label: item.body_md.slice(range.start, range.end).replace(/\s+/g, " "),
              media: null,
            }))
          : item.options.map((option) => ({
              id: option.id,
              label: option.label,
              media: option.media_idx,
            }));
  const selected = rows[Math.min(cursor, Math.max(0, rows.length - 1))] ?? null;
  // An option or step with its own media shows that; otherwise the item's media cycles with Tab.
  const shownMediaIndex = selected?.media ?? mediaIndex;
  const media: DecisionMediaRef | null = item.media[shownMediaIndex] ?? null;
  const contextMedia: DecisionMediaRef | null = item.media[mediaIndex] ?? null;
  const [scroll, setScroll] = useState(0);
  const [fullScreen, setFullScreen] = useState<DecisionMediaRef | null>(null);

  const send = (retry = false) => {
    const problem = retry
      ? draft.comment.trim()
        ? null
        : "Say what to try instead (c)."
      : draftProblem(item, draft);
    if (problem) return setStatus(problem);
    const value = draftToAnswer(item, draft, retry);
    stop();
    void answer({ environmentId: entry.environmentId, input: { id: item.id, answer: value } }).then(
      (result) => {
        if (result === null) return;
        const summary = answerSummary(item, value);
        // Text-only answers (request, playtest) summarize as a bare "Answered".
        setStatus(
          summary !== "Answered"
            ? `Answered: ${summary}`
            : value.comment
              ? `Sent: ${value.comment}`
              : "Sent.",
        );
        props.onDone(true);
      },
    );
  };

  const toggleSound = (key: string, path: string | null, video: boolean) => {
    if (playingKey === key) return stop();
    if (path === null) return setStatus("Still downloading…");
    stop();
    const child = play(path, video, loop);
    child.on("exit", () => setPlayingKey((current) => (current === key ? null : current)));
    child.on("error", (error) => setStatus(`mpv: ${error.message}`));
    player.current = child;
    setPlayingKey(key);
  };

  const openMedia = () => {
    if (!media) return;
    if (media.type === "image" || media.type === "glb") return setFullScreen(media);
    if (mediaPath === null) return setStatus("Still downloading…");
    if (media.type === "video") toggleSound(media.key, mediaPath, true);
    else openWithSystem(mediaPath);
  };

  const verdicts = VERDICT_BUTTONS[item.kind];
  const width = Math.max(20, columns - 2);
  const reading = Math.min(width, READING_WIDTH);
  const optionMedia = rows.map((row) =>
    row.media === null ? null : (item.media[row.media] ?? null),
  );
  // Tiles once any option has media; plain numbered rows otherwise.
  const tiled = item.kind !== "read" && optionMedia.some((entry) => entry !== null);
  const grid = tileGrid(width, rows.length);

  const vim = useVimMotion();
  const blocksRef = useRef(0);
  const back = () => {
    stop();
    props.onDone(false);
  };
  useKeys(
    (input, key) => {
      if (fullScreen) {
        if (key.escape || input === "q" || input === "h" || input === "o") setFullScreen(null);
        if (media?.type === "glb" && (key.leftArrow || input === "<"))
          setFrame((frame + TURNTABLE_FRAMES - 1) % TURNTABLE_FRAMES);
        if (media?.type === "glb" && (key.rightArrow || input === ">"))
          setFrame((frame + 1) % TURNTABLE_FRAMES);
        return;
      }
      if (key.escape) return back();
      if (key.return) return send();
      if (input === "N") return send(true);
      if (input === "n" || input === "J") return props.onStep(1);
      if (input === "p" && item.kind !== "read") return props.onStep(-1);
      if (input === "K") return props.onStep(-1);
      if (input === "t" && item.thread) return props.onOpenThread(item.thread);
      if (input === "c") {
        setText(draft.comment);
        return setTyping({ field: "comment" });
      }
      if (input === "]") return setCursor(Math.min(rows.length - 1, cursor + 1));
      if (input === "[") return setCursor(Math.max(0, cursor - 1));
      // Playtest keeps a lone g for its "good" note, so gg isn't a motion there.
      if (
        !(item.kind === "playtest" && input === "g") &&
        vim(input, key, {
          cursor: scroll,
          count: blocksRef.current,
          page: 6,
          onMove: setScroll,
          onBack: back,
        })
      )
        return;
      if (key.tab && item.media.length > 1)
        return setMediaIndex((mediaIndex + 1) % item.media.length);
      if (input === "o") return openMedia();
      if (media?.type === "glb" && item.kind !== "rank") {
        if (key.leftArrow || input === "<")
          return setFrame((frame + TURNTABLE_FRAMES - 1) % TURNTABLE_FRAMES);
        if (key.rightArrow || input === ">") return setFrame((frame + 1) % TURNTABLE_FRAMES);
        if (input === "C") return setClay(!clay);
      }
      const digit = Number(input);
      if (input >= "1" && input <= "9") {
        if (verdicts) {
          if (digit <= verdicts.length) setDraft({ ...draft, choice: verdicts[digit - 1]!.value });
          return;
        }
        const row = rows[digit - 1];
        if (!row) return;
        setCursor(digit - 1);
        if (item.kind === "pick") setDraft(togglePick(item, draft, row.id));
        return;
      }
      switch (item.kind) {
        case "pick":
          if (selected && input === " ") setDraft(togglePick(item, draft, selected.id));
          return;
        case "rank":
          if (input === "<" || input === ">") {
            const moved = moveRank(draft, cursor, input === ">" ? 1 : -1);
            setDraft(moved.draft);
            setCursor(moved.index);
          }
          return;
        case "listen":
          if (!selected) return;
          if (input === " ") return toggleSound(selected.id, mediaPath, false);
          if (input === "y") return setDraft(react(draft, selected.id, "keep"));
          if (input === "x") return setDraft(react(draft, selected.id, "kill"));
          if (input === "f") return setDraft(react(draft, selected.id, "favourite"));
          if (input === "m") return setDraft({ ...draft, moreLikeThese: !draft.moreLikeThese });
          if (input === "l") return setLoop(!loop);
          return;
        case "read":
          if (input === "p") {
            setText("");
            setTyping({ field: "passage", paragraph: cursor });
          }
          return;
        case "playtest":
          if (input === "i" && media?.type === "apk") {
            if (mediaPath === null) return setStatus("Still downloading…");
            setStatus("Installing on the phone…");
            void adbInstall(mediaPath).then(setStatus, (error: unknown) =>
              setStatus(String(error)),
            );
            return;
          }
          if (input === "g" || input === "b" || input === "u") {
            const field = input === "g" ? "good" : input === "b" ? "bad" : "bugs";
            setText(draft.playtest[field]);
            setTyping({ field });
          }
          return;
        case "timeline":
          if (input === "a") return setDraft({ ...draft, choice: "approve", redoFrom: null });
          if (input === "r" && selected) {
            return setDraft({ ...draft, choice: "redo", redoFrom: selected.id });
          }
          return;
        default:
          if (input === " " && (media?.type === "audio" || media?.type === "voice")) {
            toggleSound(media.key, mediaPath, false);
          }
      }
    },
    { isActive: props.active && typing === null },
  );
  // While typing a note, only Esc is ours: it leaves the note, not the decision.
  useKeys(
    (_input, key) => {
      if (key.escape) setTyping(null);
    },
    { isActive: props.active && typing !== null },
  );

  const commit = (value: string) => {
    if (!typing) return;
    if (typing.field === "comment") setDraft({ ...draft, comment: value });
    else if (typing.field === "passage")
      setDraft(addPassageComment(draft, item.body_md, typing.paragraph, value));
    else setDraft({ ...draft, playtest: { ...draft.playtest, [typing.field]: value } });
    setTyping(null);
  };

  const mark = (id: string): string => {
    switch (item.kind) {
      case "pick":
        return draft.optionIds.includes(id) ? "[x]" : "[ ]";
      case "listen": {
        const verdict = draft.reactions[id]?.verdict;
        return verdict === "keep"
          ? "keep"
          : verdict === "kill"
            ? "kill"
            : verdict === "favourite"
              ? "fav "
              : "    ";
      }
      case "timeline":
        return draft.redoFrom === id ? "redo" : "    ";
      case "read":
        return draft.passageComments.some(
          (comment) => paragraphs[Number(id)]?.start === comment.start,
        )
          ? "✎"
          : " ";
      default:
        return "";
    }
  };

  if (fullScreen) {
    return h(
      Box,
      { flexDirection: "column" },
      h(MediaView, {
        key: `full:${fullScreen.key}`,
        atoms,
        environmentId: entry.environmentId,
        media: fullScreen,
        maxColumns: width,
        maxRows: Math.max(4, height - 2),
        frame,
        clay,
        playing: false,
        framed: true,
      }),
      h(Text, { dimColor: true, wrap: "truncate" }, `${fullScreen.name} · esc close`),
    );
  }

  // Blocks scroll as units (j/k move one), so images never cut in half.
  const blocks: Array<{ readonly key: string; readonly height: number; readonly node: ReactNode }> =
    [];
  const line = (key: string, node: ReactNode) => blocks.push({ key, height: 1, node });
  const title = (item.title || item.question).trim();
  for (const [index, text] of wrapText(title, reading).entries())
    line(`title${index}`, h(Text, { bold: true }, text));
  if (item.title && item.question.trim() !== item.title.trim()) {
    for (const [index, text] of wrapText(item.question, reading).entries())
      line(`q${index}`, h(Text, null, text));
  }
  if (item.kind !== "read") {
    for (const [index, text] of wrapText(item.body_md, reading).entries())
      line(`b${index}`, h(Text, { dimColor: true }, text || " "));
  }
  if (contextMedia && !tiled) {
    const rowsForMedia = Math.max(4, Math.min(height - 12, 18));
    blocks.push({
      key: `m:${media?.key ?? contextMedia.key}`,
      height: rowsForMedia,
      node: h(MediaView, {
        atoms,
        environmentId: entry.environmentId,
        media: media ?? contextMedia,
        maxColumns: width,
        maxRows: rowsForMedia,
        frame,
        clay,
        playing: playingKey === (media ?? contextMedia).key || playingKey === selected?.id,
        onPath: setMediaPath,
      }),
    });
  }
  const optionLabel = (row: (typeof rows)[number], index: number) => {
    const recommended = item.options.find((option) => option.id === row.id)?.recommended;
    const prefix = index < 9 ? `${index + 1}` : " ";
    const label = item.kind === "rank" ? `${index + 1}. ${row.label}` : row.label;
    return `${prefix} ${mark(row.id)} ${label}${recommended ? " ★" : ""}`.replace(/ {2,}/g, " ");
  };
  if (tiled) {
    for (let start = 0; start < rows.length; start += grid.perRow) {
      const slice = rows.slice(start, start + grid.perRow);
      blocks.push({
        key: `tiles${start}`,
        height: grid.tileRows,
        node: h(
          Box,
          { gap: 1 },
          ...slice.map((row, offset) => {
            const index = start + offset;
            const focused = index === cursor;
            const mediaRef = optionMedia[index] ?? null;
            return h(
              Box,
              {
                key: row.id,
                flexDirection: "column",
                width: grid.tileColumns,
                borderStyle: "round",
                borderColor: focused ? "cyan" : "gray",
              },
              mediaRef
                ? h(MediaView, {
                    atoms,
                    environmentId: entry.environmentId,
                    media: mediaRef,
                    maxColumns: grid.frameColumns,
                    maxRows: grid.frameRows,
                    frame,
                    clay,
                    playing: playingKey === row.id,
                    framed: true,
                    ...(focused ? { onPath: setMediaPath } : {}),
                  })
                : h(
                    Box,
                    {
                      width: grid.frameColumns,
                      height: grid.frameRows,
                      backgroundColor: LETTERBOX,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingX: 1,
                    },
                    h(Text, { wrap: "wrap" }, row.label),
                  ),
              h(
                Text,
                { wrap: "truncate", ...(focused ? { color: "cyan", bold: true } : {}) },
                optionLabel(row, index),
              ),
            );
          }),
        ),
      });
    }
  } else {
    for (const [index, row] of rows.entries()) {
      const focused = index === cursor;
      line(
        `r${row.id}`,
        h(
          Text,
          { wrap: "truncate", ...(focused ? { color: "cyan" } : {}) },
          `${focused ? "›" : " "} ${optionLabel(row, index)}`,
        ),
      );
    }
  }
  if (verdicts) {
    line(
      "v",
      h(
        Box,
        { gap: 1 },
        ...verdicts.map((verdict, index) =>
          h(
            Text,
            draft.choice === verdict.value
              ? { key: verdict.value, inverse: true, bold: true }
              : { key: verdict.value },
            ` ${index + 1} ${verdict.label} `,
          ),
        ),
      ),
    );
  }
  const notes = [
    draft.comment ? `note: ${draft.comment}` : "",
    item.kind === "playtest"
      ? (["good", "bad", "bugs"] as const)
          .filter((field) => draft.playtest[field])
          .map((field) => `${field}: ${draft.playtest[field]}`)
          .join(" · ")
      : "",
    item.kind === "listen" && draft.moreLikeThese ? "more like these" : "",
    item.kind === "timeline" && draft.choice === "approve" ? "approve the run" : "",
  ].filter(Boolean);
  if (notes.length > 0) line("n", h(Text, { dimColor: true, wrap: "truncate" }, notes.join(" · ")));
  blocksRef.current = blocks.length;

  const meta = [
    KIND_TAG[item.kind],
    item.project,
    entry.environmentLabel,
    item.blocking ? "blocking" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const footer = typing
    ? h(
        Box,
        { flexDirection: "column" },
        h(
          Text,
          { dimColor: true },
          `${
            typing.field === "comment"
              ? "Note"
              : typing.field === "passage"
                ? "Comment on this paragraph"
                : PLAYTEST_LABEL[typing.field]
          } (enter keeps it, esc leaves the note):`,
        ),
        h(TextInput, {
          value: text,
          active: props.active,
          multiline: true,
          onChange: setText,
          onSubmit: commit,
        }),
      )
    : h(KeyHints, {
        hints: keyHints(
          item.kind,
          media?.type ?? null,
          item.media.length > 1 && !tiled,
          !!item.thread,
        ),
      });
  const available = Math.max(4, height - (typing ? 4 : 2) - 2);
  const first = Math.min(scroll, Math.max(0, blocks.length - 1));
  const visibleBlocks: Array<(typeof blocks)[number]> = [];
  let used = 0;
  for (const block of blocks.slice(first)) {
    if (used + block.height > available && visibleBlocks.length > 0) break;
    visibleBlocks.push(block);
    used += block.height;
  }
  const hiddenBelow = first + visibleBlocks.length < blocks.length;
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { justifyContent: "space-between" },
      h(
        Text,
        { dimColor: true, wrap: "truncate" },
        `${meta}${props.position ? ` · ${props.position}` : ""}`,
      ),
      item.thread ? h(Text, { color: "cyan" }, "t open thread") : null,
    ),
    h(
      Box,
      { flexDirection: "column", height: available },
      ...visibleBlocks.map((block) => h(Box, { key: block.key, flexShrink: 0 }, block.node)),
    ),
    h(
      Text,
      { dimColor: true },
      first > 0 || hiddenBelow ? `${first > 0 ? "↑ k " : ""}${hiddenBelow ? "↓ j more" : ""}` : " ",
    ),
    footer,
  );
}

/** A row of small key chips: the key, then what it does. */
function KeyHints({ hints }: { readonly hints: ReadonlyArray<readonly [string, string]> }) {
  return h(
    Box,
    { flexWrap: "wrap", columnGap: 1 },
    ...hints.map(([key, label]) =>
      h(
        Box,
        { key: `${key}:${label}`, flexShrink: 0 },
        h(Text, { inverse: true }, ` ${key} `),
        h(Text, { dimColor: true }, ` ${label}`),
      ),
    ),
  );
}

function keyHints(
  kind: DecisionEntry["item"]["kind"],
  media: DecisionMediaRef["type"] | null,
  manyMedia: boolean,
  hasThread: boolean,
): ReadonlyArray<readonly [string, string]> {
  const byKind: Record<DecisionEntry["item"]["kind"], ReadonlyArray<readonly [string, string]>> = {
    pick: [["1-9", "pick"]],
    rank: [
      ["1-9", "select"],
      ["</>", "move"],
    ],
    listen: [
      ["1-9", "select"],
      ["space", "play"],
      ["y/x/f", "keep/kill/fav"],
      ["l", "loop"],
    ],
    look: [["1-3", "verdict"]],
    review: [["1-3", "verdict"]],
    read: [
      ["1-2", "verdict"],
      ["]/[", "paragraph"],
      ["p", "comment"],
    ],
    pitch: [["1-3", "verdict"]],
    request: [["c", "write it"]],
    playtest: [
      ["i", "install"],
      ["g/b/u", "notes"],
    ],
    timeline: [
      ["1-9", "step"],
      ["a", "approve"],
      ["r", "redo here"],
    ],
  };
  return [
    ...byKind[kind],
    ...(media === "image" || media === "glb" ? ([["o", "full screen"]] as const) : []),
    ...(media === "glb" ? ([["←→", "turn"]] as const) : []),
    ...(media === "video" || media === "file" || media === "text"
      ? ([["o", "open"]] as const)
      : []),
    ...(manyMedia ? ([["tab", "media"]] as const) : []),
    ["enter", "send"],
    ["c", "note"],
    ["n/p", "next/prev"],
    ["j/k", "scroll"],
    ...(hasThread ? ([["t", "thread"]] as const) : []),
    ["esc", "back"],
  ];
}
