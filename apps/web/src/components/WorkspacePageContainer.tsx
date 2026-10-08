import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

export type WorkspacePageWidth = "readable" | "wide" | "expanded";

const WIDTH_CLASS: Record<WorkspacePageWidth, string> = {
  readable: "max-w-4xl",
  wide: "max-w-5xl",
  expanded: "max-w-6xl",
};

/** The max width and side padding above, as variables for `WorkspacePageHeader alignWith`. */
export const CONTENT_FRAME_VARS_CLASS: Record<WorkspacePageWidth, string> = {
  readable: "[--content-max:56rem] [--content-pad:1.25rem] sm:[--content-pad:1.5rem]",
  wide: "[--content-max:64rem] [--content-pad:1.25rem] sm:[--content-pad:1.5rem]",
  expanded: "[--content-max:72rem] [--content-pad:1.25rem] sm:[--content-pad:1.5rem]",
};

/** Shared content frame for workspace pages. */
export function WorkspacePageContainer({
  width = "readable",
  alignedHeader = false,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly width?: WorkspacePageWidth;
  /** The page's header uses `alignWith={width}`; keep the left edges together. */
  readonly alignedHeader?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-5 pt-6 pb-12 sm:px-6",
        WIDTH_CLASS[width],
        alignedHeader && [CONTENT_FRAME_VARS_CLASS[width], "workspace-content-clears-titlebar"],
        className,
      )}
      {...props}
    />
  );
}
