import type { SVGProps } from "react";

// A neutral glyph where upstream draws its wordmark (work-log rows for the
// app's own tools). czcode shows no logo or name inside the UI.
export function CzWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
    </svg>
  );
}
