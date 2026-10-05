import type { ColorValue } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedCircle = withUniwind(Circle);

/**
 * A neutral glyph where upstream draws its wordmark (work-log rows for the
 * app's own tools). czcode shows no logo or name inside the UI.
 */
export function CzWordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg height={props.height} width={props.height} viewBox="0 0 16 16">
      <ThemedCircle
        cx={8}
        cy={8}
        r={3}
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
