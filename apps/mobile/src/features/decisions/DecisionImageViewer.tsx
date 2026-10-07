import { Image } from "expo-image";
import { useState } from "react";
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";

export interface ViewerImage {
  readonly uri: string;
  readonly label: string;
  /** The option this image stands for, when it can be picked from full screen. */
  readonly optionId?: string;
}

/** One image that pinches to zoom, pans while zoomed, and resets on double tap. */
function ZoomableImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(5, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });
  // Panning only while zoomed, so a flat image still swipes to the next one.
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      if (scale.value > 1) state.activate();
      else state.fail();
    })
    .onUpdate((event) => {
      x.value = savedX.value + event.translationX;
      y.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      x.value = withTiming(0);
      y.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, reset)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} contentFit="contain" style={{ width, height }} />
      </Animated.View>
    </GestureDetector>
  );
}

/** Full-screen images: swipe between them, pinch to zoom, and pick an option from here. */
export function DecisionImageViewer({
  images,
  index,
  pickedIds,
  onPick,
  onClose,
}: {
  images: ReadonlyArray<ViewerImage>;
  index: number;
  pickedIds: ReadonlyArray<string>;
  onPick?: (optionId: string) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index);
  const image = images[current];
  const imageHeight = height - insets.top - insets.bottom - 140;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "black" }}>
        <View
          style={{ paddingTop: insets.top + 8 }}
          className="flex-row items-center justify-between px-4 pb-2"
        >
          <Text className="flex-1 text-sm text-white" numberOfLines={2}>
            {image?.label}
            {images.length > 1 ? `  (${current + 1}/${images.length})` : ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
          >
            <Text className="text-base text-white">Close</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}
          onMomentumScrollEnd={(event) =>
            setCurrent(Math.round(event.nativeEvent.contentOffset.x / width))
          }
        >
          {images.map((entry) => (
            <View
              key={entry.uri}
              style={{ width, height: imageHeight }}
              className="items-center justify-center"
            >
              <ZoomableImage uri={entry.uri} width={width} height={imageHeight} />
            </View>
          ))}
        </ScrollView>
        <View style={{ paddingBottom: insets.bottom + 12 }} className="items-center px-4 pt-3">
          {image?.optionId && onPick ? (
            <MaterialButton
              tone={pickedIds.includes(image.optionId) ? "secondary" : "primary"}
              label={pickedIds.includes(image.optionId) ? "Picked" : "Pick this"}
              onPress={() => onPick(image.optionId!)}
            />
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
