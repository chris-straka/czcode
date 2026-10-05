import {
  answerSummary,
  type DecisionDraft,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  VERDICT_BUTTONS,
} from "@cz/client-runtime/decisions/draft";
import type { DecisionMediaRef } from "@cz/contracts";
import { Box, Text, useInput } from "ink";
import { createElement as h, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChildProcess } from "node:child_process";

import { type DecisionEntry, KIND_TAG } from "../model/decisionFeed.ts";
import {
  addPassageComment,
  moveRank,
  paragraphRanges,
  react,
  togglePick,
} from "../model/decisionDraft.ts";
import { adbInstall, openInF3d, openWithSystem, play, TURNTABLE_FRAMES } from "../model/media.ts";
import { wrapText } from "../model/wrap.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { StatusContext, useCommand } from "./command.ts";
import { useViewport } from "./hooks.ts";
import { MediaView } from "./MediaView.ts";
import { TextInput } from "./TextInput.ts";

type Typing =
  | { readonly field: "comment" }
  | { readonly field: "good" | "bad" | "bugs" }
  | { readonly field: "passage"; readonly paragraph: number };

const PLAYTEST_LABEL = { good: "What felt good", bad: "What felt bad", bugs: "Bugs" } as const;

/**
 * One decision, answered from the keyboard. Every kind shares: ↑↓/jk move,
 * c comment, Enter send, N "none of these, try again", Esc back. Kinds add:
 * pick space · rank J/K · listen space play, y keep, x kill, f favourite,
 * l loop, m more · verdicts 1-3 · look ←→ turn, C clay, o free orbit ·
 * read p comment on a paragraph · playtest i install, g/b/u fields ·
 * timeline a approve, r redo from here.
 */
export function DecisionScreen(props: {
  readonly atoms: TuiAtoms;
  readonly entry: DecisionEntry;
  readonly active: boolean;
  readonly onDone: () => void;
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
  const player = useRef<ChildProcess | null>(null);

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
        props.onDone();
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
    if (mediaPath === null) return setStatus("Still downloading…");
    if (media.type === "glb") openInF3d(mediaPath);
    else if (media.type === "video") toggleSound(media.key, mediaPath, true);
    else openWithSystem(mediaPath);
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        stop();
        return props.onDone();
      }
      if (key.return) return send();
      if (input === "N") return send(true);
      if (input === "c") {
        setText(draft.comment);
        return setTyping({ field: "comment" });
      }
      if (key.downArrow || input === "j") return setCursor(Math.min(rows.length - 1, cursor + 1));
      if (key.upArrow || input === "k") return setCursor(Math.max(0, cursor - 1));
      if (key.tab && item.media.length > 1)
        return setMediaIndex((mediaIndex + 1) % item.media.length);
      if (input === "o") return openMedia();
      if (media?.type === "glb") {
        if (key.leftArrow || input === "h")
          return setFrame((frame + TURNTABLE_FRAMES - 1) % TURNTABLE_FRAMES);
        if (key.rightArrow || input === "l") return setFrame((frame + 1) % TURNTABLE_FRAMES);
        if (input === "C") return setClay(!clay);
      }
      const verdicts = VERDICT_BUTTONS[item.kind];
      const digit = Number(input);
      if (verdicts && digit >= 1 && digit <= verdicts.length) {
        return setDraft({ ...draft, choice: verdicts[digit - 1]!.value });
      }
      switch (item.kind) {
        case "pick":
          if (selected && input === " ") setDraft(togglePick(item, draft, selected.id));
          return;
        case "rank":
          if (input === "J" || input === "K") {
            const moved = moveRank(draft, cursor, input === "J" ? 1 : -1);
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
          if (input === "L") return setLoop(!loop);
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
  useInput(
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

  const width = Math.max(20, columns - 2);
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

  const header = `${KIND_TAG[item.kind]} · ${item.project}${entry.environmentLabel ? ` · ${entry.environmentLabel}` : ""}${item.blocking ? " · blocking" : ""}`;
  const question = wrapText(item.question, width);
  const bodyLines = item.kind === "read" ? [] : wrapText(item.body_md, width).slice(0, 6);
  const listRows = Math.max(3, Math.min(rows.length, Math.floor((height - 10) / 3)));
  const top = Math.max(0, Math.min(cursor - Math.floor(listRows / 2), rows.length - listRows));
  const mediaRows = Math.max(4, height - question.length - bodyLines.length - listRows - 9);
  const verdicts = VERDICT_BUTTONS[item.kind];

  const children: Array<ReactNode> = [
    h(Text, { key: "h", dimColor: true, wrap: "truncate" }, header),
    ...question.map((line, index) => h(Text, { key: `q${index}`, bold: true }, line)),
    ...bodyLines.map((line, index) => h(Text, { key: `b${index}` }, line || " ")),
  ];
  if (media) {
    children.push(
      h(MediaView, {
        key: `m:${media.key}`,
        atoms,
        environmentId: entry.environmentId,
        media,
        maxColumns: width,
        maxRows: mediaRows,
        frame,
        clay,
        playing: playingKey === media.key || playingKey === selected?.id,
        onPath: setMediaPath,
      }),
    );
  }
  if (rows.length > 0) {
    children.push(
      ...rows.slice(top, top + listRows).map((row, offset) => {
        const index = top + offset;
        const focused = index === cursor;
        const label = item.kind === "rank" ? `${index + 1}. ${row.label}` : row.label;
        return h(
          Text,
          { key: `r${row.id}`, wrap: "truncate", ...(focused ? { color: "cyan" } : {}) },
          `${focused ? "› " : "  "}${mark(row.id)} ${label}${item.options.find((option) => option.id === row.id)?.recommended ? " ★" : ""}`,
        );
      }),
    );
  }
  if (verdicts) {
    children.push(
      h(
        Text,
        { key: "v" },
        verdicts
          .map((verdict, index) =>
            draft.choice === verdict.value
              ? `[${index + 1} ${verdict.label}]`
              : ` ${index + 1} ${verdict.label} `,
          )
          .join(" "),
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
  if (notes.length > 0)
    children.push(h(Text, { key: "n", dimColor: true, wrap: "truncate" }, notes.join(" · ")));
  children.push(
    typing
      ? h(
          Box,
          { key: "t", flexDirection: "column" },
          h(
            Text,
            { dimColor: true },
            typing.field === "comment"
              ? "Comment:"
              : typing.field === "passage"
                ? "Comment on this paragraph:"
                : `${PLAYTEST_LABEL[typing.field]}:`,
          ),
          h(TextInput, {
            value: text,
            active: props.active,
            multiline: true,
            onChange: setText,
            onSubmit: commit,
          }),
        )
      : h(
          Text,
          { key: "k", dimColor: true, wrap: "wrap" },
          keyHelp(item.kind, media?.type ?? null, item.media.length > 1),
        ),
  );
  return h(Box, { flexDirection: "column" }, ...children);
}

function keyHelp(
  kind: DecisionEntry["item"]["kind"],
  media: DecisionMediaRef["type"] | null,
  manyMedia: boolean,
): string {
  const byKind: Record<DecisionEntry["item"]["kind"], string> = {
    pick: "space choose",
    rank: "J/K move",
    listen: "space play · y keep · x kill · f fav · L loop · m more",
    look: "1-3 verdict",
    review: "1-3 verdict",
    read: "p comment paragraph · 1-2 verdict",
    pitch: "1-3 verdict",
    request: "c write it",
    playtest: "i install · g good · b bad · u bugs",
    timeline: "a approve · r redo from here",
  };
  const mediaKeys =
    media === "glb"
      ? " · ←→ turn · C clay · o orbit"
      : media === "video"
        ? " · o play"
        : media === "file" || media === "text"
          ? " · o open"
          : "";
  return `${byKind[kind]}${mediaKeys}${manyMedia ? " · tab media" : ""} · c note · enter send · N none · esc`;
}
