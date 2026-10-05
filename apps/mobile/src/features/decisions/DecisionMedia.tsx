import { resolveAssetUrl } from "@cz/client-runtime/state/assets";
import type { DecisionMediaRef, EnvironmentId } from "@cz/contracts";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { usePreparedConnection } from "../../state/session";

/** The media's signed URL, resolved against the host it lives on. */
export function useDecisionMediaUrl(
  environmentId: EnvironmentId,
  media: DecisionMediaRef | null | undefined,
): string | null {
  const connection = usePreparedConnection(environmentId);
  if (!media?.url || connection._tag !== "Some") return null;
  return resolveAssetUrl(connection.value.httpBaseUrl, media.url);
}

/** Plays one sound; tap to play or pause, the loop toggle repeats it. */
export function DecisionAudio({ uri, label }: { uri: string; label?: string }) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    player.loop = loop;
  }, [loop, player]);
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? `Pause ${label ?? "sound"}` : `Play ${label ?? "sound"}`
        }
        onPress={() => {
          if (status.playing) player.pause();
          else {
            if (status.didJustFinish || status.currentTime >= status.duration)
              void player.seekTo(0);
            player.play();
          }
        }}
        className="h-11 w-11 items-center justify-center rounded-full bg-primary active:opacity-70"
      >
        <Text className="text-lg text-primary-foreground">{status.playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <View className="h-1 flex-1 overflow-hidden rounded-full bg-subtle">
        <View
          className="h-1 bg-primary"
          style={{
            width: `${status.duration ? (status.currentTime / status.duration) * 100 : 0}%`,
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Loop"
        accessibilityState={{ selected: loop }}
        onPress={() => setLoop((value) => !value)}
        className={loop ? "rounded-full bg-subtle-strong px-3 py-2" : "rounded-full px-3 py-2"}
      >
        <Text className="text-xs text-foreground-muted">Loop</Text>
      </Pressable>
    </View>
  );
}

function DecisionVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "black", borderRadius: 12 }}
    />
  );
}

/** `<model-viewer>` in a WebView: orbit, animations, and a clay view (the Look view). */
export function DecisionModel({ uri }: { uri: string }) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js"></script>
<style>html,body{margin:0;height:100%;background:transparent;color:#ccc;font:14px system-ui}model-viewer{width:100%;height:calc(100% - 44px)}#bar{display:flex;gap:8px;padding:6px;overflow-x:auto}button{background:#2a2a2a;color:#eee;border:0;border-radius:14px;padding:6px 12px}</style></head>
<body><model-viewer id="m" src=${JSON.stringify(uri)} camera-controls touch-action="pan-y" shadow-intensity="1"></model-viewer>
<div id="bar"><button id="clay">Clay</button></div>
<script>const m=document.getElementById("m");let clay=false,orig=[];
m.addEventListener("load",()=>{orig=m.model.materials.map(x=>({c:x.pbrMetallicRoughness.baseColorFactor,t:x.pbrMetallicRoughness.baseColorTexture&&x.pbrMetallicRoughness.baseColorTexture.texture}));
const d=m.getDimensions();const s=document.createElement("span");s.textContent=d.x.toFixed(2)+"×"+d.y.toFixed(2)+"×"+d.z.toFixed(2)+" m";bar.appendChild(s);
for(const a of m.availableAnimations){const b=document.createElement("button");b.textContent=a;b.onclick=()=>{m.animationName=a;m.play()};bar.appendChild(b)}});
document.getElementById("clay").onclick=()=>{clay=!clay;m.model.materials.forEach((x,i)=>{const p=x.pbrMetallicRoughness;if(clay){p.baseColorTexture&&p.baseColorTexture.setTexture(null);p.setBaseColorFactor([.72,.7,.68,1])}else{p.baseColorTexture&&p.baseColorTexture.setTexture(orig[i].t);p.setBaseColorFactor(orig[i].c)}})};</script></body></html>`;
  return (
    <View style={{ height: 420 }} className="overflow-hidden rounded-xl bg-subtle">
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ backgroundColor: "transparent" }}
        javaScriptEnabled
      />
    </View>
  );
}

/** One attachment, sized for a card (`compact`) or the full view. */
export function DecisionMedia({
  environmentId,
  media,
  compact = false,
}: {
  environmentId: EnvironmentId;
  media: DecisionMediaRef;
  compact?: boolean;
}) {
  const uri = useDecisionMediaUrl(environmentId, media);
  if (!uri)
    return <View className={compact ? "h-20 rounded-lg bg-subtle" : "h-48 rounded-lg bg-subtle"} />;
  switch (media.type) {
    case "image":
      return (
        <Image
          source={{ uri }}
          accessibilityLabel={media.caption ?? media.name}
          contentFit={compact ? "cover" : "contain"}
          style={{ width: "100%", height: compact ? 96 : 320, borderRadius: 10 }}
        />
      );
    case "audio":
    case "voice":
      return <DecisionAudio uri={uri} label={media.name} />;
    case "video":
      return <DecisionVideo uri={uri} />;
    case "glb":
      return compact ? <View className="h-20 rounded-lg bg-subtle" /> : <DecisionModel uri={uri} />;
    case "apk":
      return (
        <MaterialButton
          tone="primary"
          label={`Install ${media.name}`}
          onPress={() => void Linking.openURL(uri)}
        />
      );
    default:
      return <MaterialButton label={media.name} onPress={() => void Linking.openURL(uri)} />;
  }
}
