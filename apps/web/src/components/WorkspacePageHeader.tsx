import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";
import { CONTENT_FRAME_VARS_CLASS, type WorkspacePageWidth } from "./WorkspacePageContainer";

/** Shared workspace top-bar geometry. */
export function WorkspacePageHeader({
  electron = false,
  reserveNativeControls = electron,
  alignWith,
  className,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
  readonly reserveNativeControls?: boolean;
  /** Line the contents up with the page's content column of this width. */
  readonly alignWith?: WorkspacePageWidth;
}) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left,padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        electron && "drag-region",
        alignWith
          ? ["workspace-header-aligned", CONTENT_FRAME_VARS_CLASS[alignWith]]
          : [
              "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
              reserveNativeControls && "wco:pr-(--workspace-native-controls-inset)",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            ],
        className,
      )}
      {...props}
    />
  );
}
