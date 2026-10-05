import {
  type DecisionDraft,
  answerSummary,
  draftProblem,
  draftToAnswer,
  emptyDraft,
  VERDICT_BUTTONS,
} from "@cz/client-runtime/decisions/draft";
import type {
  DecisionAnswerInput,
  DecisionMediaRef,
  DecisionMediaUploadQuery,
  DecisionRedline,
} from "@cz/contracts";
import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { type DecisionEntry, decisionEnvironment, useOpenDecisions } from "../../state/decisions";
import { useAtomCommand } from "../../state/use-atom-command";
import { DecisionAudio, DecisionMedia, useDecisionMediaUrl } from "./DecisionMedia";

const UNDO_WINDOW_MS = 5_000;

type Upload = (
  meta: DecisionMediaUploadQuery,
  bytes: Uint8Array,
) => Promise<DecisionMediaRef | null>;

type Params = {
  readonly environmentId: string;
  readonly id: string;
  readonly session?: string;
};

/** One decision, full screen, with its answer controls pinned to the bottom. */
export function DecisionRouteScreen({ route }: StaticScreenProps<Params>) {
  const navigation = useNavigation();
  const params = route.params;
  const feed = useOpenDecisions();
  const [frozen, setFrozen] = useState<DecisionEntry | null>(null);
  const live =
    feed.entries.find(
      (entry) => entry.environmentId === params.environmentId && entry.item.id === params.id,
    ) ?? null;
  const entry = frozen ?? live;
  const answerCommand = useAtomCommand(decisionEnvironment.answer, "answer decision");
  const uploadCommand = useAtomCommand(decisionEnvironment.upload, "upload decision media");
  const [pending, setPending] = useState<{ answer: DecisionAnswerInput; left: number } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const goNext = () => {
    const next =
      params.session === "1"
        ? feed.entries.find((candidate) => candidate.item.id !== params.id)
        : undefined;
    if (next) {
      navigation.setParams({ environmentId: next.environmentId, id: next.item.id } as never);
      setFrozen(null);
      setPending(null);
    } else {
      navigation.goBack();
    }
  };

  if (!entry) {
    return (
      <View className="flex-1 bg-screen">
        <AndroidScreenHeader title="Decision" onBack={() => navigation.goBack()} />
        <Text className="p-5 text-foreground-muted">This decision is no longer open.</Text>
      </View>
    );
  }

  const upload: Upload = async (meta, bytes) => {
    const result = await uploadCommand({
      environmentId: entry.environmentId,
      input: { meta, bytes },
    });
    return result._tag === "Success" ? (result.value as DecisionMediaRef) : null;
  };

  const submit = (answer: DecisionAnswerInput) => {
    setFrozen(entry);
    setPending({ answer, left: UNDO_WINDOW_MS / 1000 });
    let left = UNDO_WINDOW_MS / 1000;
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) return setPending((current) => (current ? { ...current, left } : current));
      if (timer.current) clearInterval(timer.current);
      void answerCommand({
        environmentId: entry.environmentId,
        input: { id: entry.item.id, answer },
      }).then(goNext);
    }, 1000);
  };

  return (
    <View className="flex-1 bg-screen">
      <AndroidScreenHeader
        title={entry.item.kind}
        subtitle={`${entry.item.project} · ${entry.environmentLabel}`}
        onBack={() => navigation.goBack()}
        {...(params.session === "1"
          ? { actions: [{ accessibilityLabel: "Skip", icon: "chevron.right", onPress: goNext }] }
          : {})}
      />
      {pending ? (
        <View className="m-4 flex-row items-center gap-3 rounded-xl bg-subtle p-4">
          <Text className="flex-1 text-foreground">
            Answered: {answerSummary(entry.item, pending.answer)}
          </Text>
          <MaterialButton
            tone="text"
            label={`Undo (${pending.left})`}
            onPress={() => {
              if (timer.current) clearInterval(timer.current);
              setPending(null);
              setFrozen(null);
            }}
          />
        </View>
      ) : (
        <DecisionAnswerForm
          key={`${entry.environmentId}:${entry.item.id}`}
          entry={entry}
          onSubmit={submit}
          onUpload={upload}
        />
      )}
    </View>
  );
}

function DecisionAnswerForm({
  entry,
  onSubmit,
  onUpload,
}: {
  entry: DecisionEntry;
  onSubmit: (answer: DecisionAnswerInput) => void;
  onUpload: Upload;
}) {
  const { item } = entry;
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDraft(item));
  const update = (patch: Partial<DecisionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const submit = (patch: Partial<DecisionDraft> = {}, retry = false) =>
    onSubmit(draftToAnswer(item, { ...draft, ...patch }, retry));
  const problem = draftProblem(item, draft);
  const verdicts = VERDICT_BUTTONS[item.kind];
  const hasNote = draft.comment.trim().length > 0 || draft.voiceKey !== null;

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        <Text className="text-xl font-cz-bold text-foreground">{item.question}</Text>
        {item.blocking ? (
          <Text className="text-sm text-warning">An agent is waiting on this.</Text>
        ) : null}
        {item.cost_note ? <Text className="text-sm text-warning">{item.cost_note}</Text> : null}
        {item.kind !== "read" && item.body_md ? (
          <Text className="text-sm text-foreground-muted">{item.body_md}</Text>
        ) : null}
        <DecisionBody entry={entry} draft={draft} update={update} onUpload={onUpload} />
      </ScrollView>
      <View
        className="gap-3 border-t border-subtle-strong bg-screen p-4"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <View className="flex-row items-end gap-2">
          <TextInput
            accessibilityLabel="Note"
            placeholder={
              item.kind === "request" ? "Write it here, attach, or record" : "Add a note (optional)"
            }
            placeholderTextColor="#888"
            multiline
            value={draft.comment}
            onChangeText={(comment) => update({ comment })}
            className="max-h-32 min-h-11 flex-1 rounded-xl bg-subtle px-3 py-2 text-foreground"
          />
          <VoiceNoteButton
            recorded={draft.voiceKey !== null}
            onRecorded={async (bytes) => {
              const ref = await onUpload(
                { name: "voice-note.m4a", mime: "audio/mp4", type: "voice" },
                bytes,
              );
              if (ref) update({ voiceKey: ref.key });
            }}
          />
        </View>
        <View className="flex-row flex-wrap gap-2">
          {verdicts ? (
            verdicts.map((verdict) => (
              <MaterialButton
                key={verdict.value}
                tone={
                  verdict.value === "reject" || verdict.value === "never" ? "secondary" : "primary"
                }
                label={verdict.label}
                onPress={() => submit({ choice: verdict.value })}
              />
            ))
          ) : item.kind === "timeline" ? (
            <>
              <MaterialButton
                tone="primary"
                label="Approve run"
                onPress={() => submit({ choice: "approve", redoFrom: null })}
              />
              <MaterialButton
                label="Redo from step"
                disabled={draft.redoFrom === null}
                onPress={() => submit({ choice: "redo" })}
              />
            </>
          ) : (
            <MaterialButton
              tone="primary"
              label="Send"
              disabled={problem !== null}
              onPress={() => submit()}
            />
          )}
          {item.options.length > 0 && item.kind !== "rank" ? (
            <MaterialButton
              tone="text"
              label="None of these"
              disabled={!hasNote}
              onPress={() => submit({}, true)}
            />
          ) : null}
        </View>
        {problem && !verdicts && item.kind !== "timeline" ? (
          <Text className="text-xs text-foreground-muted">{problem}</Text>
        ) : null}
      </View>
    </View>
  );
}

interface BodyProps {
  readonly entry: DecisionEntry;
  readonly draft: DecisionDraft;
  readonly update: (patch: Partial<DecisionDraft>) => void;
  readonly onUpload: Upload;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={
        selected ? "rounded-full bg-primary px-3 py-2" : "rounded-full bg-subtle px-3 py-2"
      }
    >
      <Text className={selected ? "text-sm text-primary-foreground" : "text-sm text-foreground"}>
        {label}
      </Text>
    </Pressable>
  );
}

function DecisionBody(props: BodyProps) {
  const { entry, draft, update } = props;
  const { item } = entry;
  switch (item.kind) {
    case "pick":
      return (
        <View className="gap-3">
          {item.options.map((option) => {
            const media = option.media_idx === null ? null : item.media[option.media_idx];
            const selected = draft.optionIds.includes(option.id);
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() =>
                  update({
                    optionIds:
                      item.max_choices === 1
                        ? [option.id]
                        : selected
                          ? draft.optionIds.filter((id) => id !== option.id)
                          : [...draft.optionIds, option.id],
                  })
                }
                className={
                  selected
                    ? "gap-2 rounded-xl border-2 border-primary p-3"
                    : "gap-2 rounded-xl border border-subtle-strong p-3"
                }
              >
                {media ? <DecisionMedia environmentId={entry.environmentId} media={media} /> : null}
                <Text className="font-cz-medium text-foreground">
                  {option.label}
                  {option.recommended ? "  · recommended" : ""}
                </Text>
                {option.reason ? (
                  <Text className="text-xs text-foreground-muted">{option.reason}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      );
    case "rank":
      return (
        <View className="gap-2">
          {draft.rank.map((id, index) => (
            <View key={id} className="flex-row items-center gap-2 rounded-xl bg-subtle p-3">
              <Text className="w-6 text-foreground-muted">{index + 1}</Text>
              <Text className="flex-1 text-foreground">
                {item.options.find((option) => option.id === id)?.label ?? id}
              </Text>
              {[-1, 1].map((delta) => (
                <MaterialButton
                  key={delta}
                  tone="text"
                  label={delta < 0 ? "Up" : "Down"}
                  onPress={() => {
                    const target = index + delta;
                    if (target < 0 || target >= draft.rank.length) return;
                    const next = [...draft.rank];
                    [next[index], next[target]] = [next[target]!, next[index]!];
                    update({ rank: next });
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      );
    case "listen":
      return <ListenBody {...props} />;
    case "review":
      return (
        <View className="gap-3">
          {item.media.map((media, index) =>
            media.type === "image" ? (
              <RedlineImage
                key={media.key}
                entry={entry}
                media={media}
                strokes={draft.redlines.filter((stroke) => stroke.media_idx === index)}
                onStroke={(points) =>
                  update({ redlines: [...draft.redlines, { media_idx: index, points }] })
                }
              />
            ) : (
              <DecisionMedia key={media.key} environmentId={entry.environmentId} media={media} />
            ),
          )}
        </View>
      );
    case "read":
      return <ReadBody {...props} />;
    case "playtest":
      return (
        <View className="gap-3">
          {item.media.map((media) => (
            <DecisionMedia key={media.key} environmentId={entry.environmentId} media={media} />
          ))}
          {(["good", "bad", "bugs"] as const).map((key) => (
            <TextInput
              key={key}
              accessibilityLabel={key}
              placeholder={
                key === "good" ? "What felt good" : key === "bad" ? "What felt bad" : "Bugs"
              }
              placeholderTextColor="#888"
              multiline
              value={draft.playtest[key]}
              onChangeText={(value) => update({ playtest: { ...draft.playtest, [key]: value } })}
              className="min-h-16 rounded-xl bg-subtle px-3 py-2 text-foreground"
            />
          ))}
        </View>
      );
    case "request":
      return <RequestBody {...props} />;
    case "timeline":
      return <TimelineBody {...props} />;
    default:
      return (
        <View className="gap-3">
          {item.media.map((media) => (
            <DecisionMedia key={media.key} environmentId={entry.environmentId} media={media} />
          ))}
        </View>
      );
  }
}

function ListenBody({ entry, draft, update }: BodyProps) {
  const { item } = entry;
  const set = (
    optionId: string,
    patch: { verdict?: "keep" | "kill" | "favourite" | null; note?: string },
  ) => {
    const current = draft.reactions[optionId] ?? { option_id: optionId, verdict: null };
    update({ reactions: { ...draft.reactions, [optionId]: { ...current, ...patch } } });
  };
  return (
    <View className="gap-3">
      {item.context_media_idx !== null && item.media[item.context_media_idx] ? (
        <DecisionMedia
          environmentId={entry.environmentId}
          media={item.media[item.context_media_idx]!}
        />
      ) : null}
      {item.options.map((option) => {
        const media = option.media_idx === null ? null : item.media[option.media_idx];
        const reaction = draft.reactions[option.id];
        return (
          <View key={option.id} className="gap-2 rounded-xl bg-subtle p-3">
            <Text className="font-cz-medium text-foreground">{option.label}</Text>
            {media ? <ListenPlayer entry={entry} media={media} label={option.label} /> : null}
            <View className="flex-row gap-2">
              {(["keep", "kill", "favourite"] as const).map((verdict) => (
                <Chip
                  key={verdict}
                  label={verdict}
                  selected={reaction?.verdict === verdict}
                  onPress={() =>
                    set(option.id, { verdict: reaction?.verdict === verdict ? null : verdict })
                  }
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel={`Note on ${option.label}`}
              placeholder="Note (too retro, more metal…)"
              placeholderTextColor="#888"
              value={reaction?.note ?? ""}
              onChangeText={(note) => set(option.id, { note })}
              className="rounded-lg bg-screen px-3 py-2 text-foreground"
            />
          </View>
        );
      })}
      <Chip
        label="More like the kept ones"
        selected={draft.moreLikeThese}
        onPress={() => update({ moreLikeThese: !draft.moreLikeThese })}
      />
    </View>
  );
}

function ListenPlayer({
  entry,
  media,
  label,
}: {
  entry: DecisionEntry;
  media: DecisionMediaRef;
  label: string;
}) {
  const uri = useDecisionMediaUrl(entry.environmentId, media);
  return uri ? <DecisionAudio uri={uri} label={label} /> : null;
}

/** An image the owner draws on with a finger; strokes are stored in 0..1 coordinates. */
function RedlineImage({
  entry,
  media,
  strokes,
  onStroke,
}: {
  entry: DecisionEntry;
  media: DecisionMediaRef;
  strokes: readonly DecisionRedline[];
  onStroke: (points: Array<[number, number]>) => void;
}) {
  const uri = useDecisionMediaUrl(entry.environmentId, media);
  const size = useRef({ width: 1, height: 1 });
  const [current, setCurrent] = useState<Array<[number, number]>>([]);
  const currentRef = useRef(current);
  currentRef.current = current;
  const point = (x: number, y: number): [number, number] => [
    Math.min(1, Math.max(0, x / size.current.width)),
    Math.min(1, Math.max(0, y / size.current.height)),
  ];
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) =>
        setCurrent([point(event.nativeEvent.locationX, event.nativeEvent.locationY)]),
      onPanResponderMove: (event) =>
        setCurrent((points) => [
          ...points,
          point(event.nativeEvent.locationX, event.nativeEvent.locationY),
        ]),
      onPanResponderRelease: () => {
        if (currentRef.current.length > 1) onStroke(currentRef.current);
        setCurrent([]);
      },
    }),
  ).current;
  const path = (points: ReadonlyArray<readonly [number, number]>) =>
    points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x * 1000} ${y * 1000}`).join(" ");
  if (!uri) return <View className="h-48 rounded-lg bg-subtle" />;
  return (
    <View className="gap-1">
      <View
        style={{ width: "100%", aspectRatio: 1 }}
        onLayout={(event) => {
          size.current = event.nativeEvent.layout;
        }}
        {...responder.panHandlers}
      >
        <Image source={{ uri }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
        <Svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          style={{ position: "absolute", width: "100%", height: "100%" }}
        >
          {[
            ...strokes.map((stroke) => stroke.points),
            ...(current.length > 0 ? [current] : []),
          ].map((points) => (
            <Path
              key={path(points)}
              d={path(points)}
              stroke="#ef4444"
              strokeWidth={8}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </Svg>
      </View>
      <Text className="text-xs text-foreground-muted">
        Draw on the image to mark what to change.
      </Text>
    </View>
  );
}

function ReadBody({ entry, draft, update }: BodyProps) {
  const body = entry.item.body_md;
  // Each paragraph with its offset in the body, so comments point at the text.
  const paragraphs = body
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .reduce<Array<{ text: string; start: number }>>((acc, text) => {
      const from =
        acc.length > 0 ? acc[acc.length - 1]!.start + acc[acc.length - 1]!.text.length : 0;
      return [...acc, { text, start: body.indexOf(text, from) }];
    }, []);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  return (
    <View className="gap-3">
      {paragraphs.map(({ text: paragraph, start }, index) => {
        const comments = draft.passageComments.filter((comment) => comment.start === start);
        return (
          <Pressable key={start} onLongPress={() => setOpen(index)} className="gap-2">
            <Text className="text-base leading-6 text-foreground">{paragraph}</Text>
            {comments.map((comment) => (
              <Text
                key={comment.note}
                className="rounded-lg bg-subtle p-2 text-sm text-foreground-muted"
              >
                {comment.note}
              </Text>
            ))}
            {open === index ? (
              <View className="flex-row gap-2">
                <TextInput
                  autoFocus
                  accessibilityLabel="Comment on this paragraph"
                  placeholder="Comment on this paragraph"
                  placeholderTextColor="#888"
                  value={note}
                  onChangeText={setNote}
                  className="flex-1 rounded-lg bg-subtle px-3 py-2 text-foreground"
                />
                <MaterialButton
                  label="Add"
                  disabled={!note.trim()}
                  onPress={() => {
                    update({
                      passageComments: [
                        ...draft.passageComments,
                        {
                          start,
                          end: start + paragraph.length,
                          quote: paragraph.slice(0, 200),
                          note: note.trim(),
                        },
                      ],
                    });
                    setNote("");
                    setOpen(null);
                  }}
                />
              </View>
            ) : null}
          </Pressable>
        );
      })}
      <Text className="text-xs text-foreground-muted">
        Long-press a paragraph to comment on it.
      </Text>
    </View>
  );
}

function RequestBody({ entry, draft, update, onUpload }: BodyProps) {
  const [busy, setBusy] = useState(false);
  return (
    <View className="gap-3">
      {entry.item.media.map((media) => (
        <DecisionMedia key={media.key} environmentId={entry.environmentId} media={media} />
      ))}
      <MaterialButton
        label={busy ? "Uploading…" : "Attach files"}
        loading={busy}
        onPress={async () => {
          const { getDocumentAsync } = await import("expo-document-picker");
          const result = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
          if (result.canceled) return;
          setBusy(true);
          const refs: DecisionMediaRef[] = [];
          for (const asset of result.assets) {
            const mime = asset.mimeType ?? "application/octet-stream";
            const ref = await onUpload(
              {
                name: asset.name,
                mime,
                type: mime.startsWith("image/")
                  ? "image"
                  : mime.startsWith("audio/")
                    ? "audio"
                    : mime.startsWith("video/")
                      ? "video"
                      : "file",
              },
              new Uint8Array(await new File(asset.uri).arrayBuffer()),
            );
            if (ref) refs.push(ref);
          }
          update({ uploads: [...draft.uploads, ...refs] });
          setBusy(false);
        }}
      />
      {draft.uploads.map((ref) => (
        <Text key={ref.key} className="text-sm text-foreground-muted">
          {ref.name}
        </Text>
      ))}
    </View>
  );
}

function TimelineBody({ entry, draft, update }: BodyProps) {
  const { item } = entry;
  const [selected, setSelected] = useState(item.steps[0]?.id ?? null);
  const step = item.steps.find((candidate) => candidate.id === selected);
  const media = step?.media_idx == null ? null : item.media[step.media_idx];
  return (
    <View className="gap-3">
      <ScrollView horizontal contentContainerClassName="gap-2">
        {item.steps.map((candidate, index) => (
          <Chip
            key={candidate.id}
            label={`${index + 1} ${candidate.label}${candidate.id === draft.redoFrom ? " ↺" : ""}`}
            selected={candidate.id === selected}
            onPress={() => setSelected(candidate.id)}
          />
        ))}
      </ScrollView>
      {media ? <DecisionMedia environmentId={entry.environmentId} media={media} /> : null}
      {step ? (
        <MaterialButton
          label={draft.redoFrom === step.id ? "Redo from here (selected)" : "Redo from here"}
          onPress={() =>
            update({ redoFrom: draft.redoFrom === step.id ? null : step.id, choice: "redo" })
          }
        />
      ) : null}
    </View>
  );
}

/** Records a voice note with the microphone and hands back its bytes. */
function VoiceNoteButton({
  recorded,
  onRecorded,
}: {
  recorded: boolean;
  onRecorded: (bytes: Uint8Array) => void | Promise<void>;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        recording ? "Stop recording" : recorded ? "Voice note recorded" : "Record a voice note"
      }
      onPress={async () => {
        if (recording) {
          await recorder.stop();
          setRecording(false);
          await setAudioModeAsync({ allowsRecording: false });
          if (recorder.uri)
            await onRecorded(new Uint8Array(await new File(recorder.uri).arrayBuffer()));
          return;
        }
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) return;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setRecording(true);
      }}
      className={
        recording
          ? "h-11 w-11 items-center justify-center rounded-full bg-danger"
          : "h-11 w-11 items-center justify-center rounded-full bg-subtle"
      }
    >
      <Text className="text-foreground">{recording ? "■" : recorded ? "✓" : "🎙"}</Text>
    </Pressable>
  );
}
