import { useEffect, type ReactNode } from "react";

import { ArrowLeftIcon } from "lucide-react";

import { Button } from "../ui/button";

/** True when Esc should leave the field rather than the view: a text field with something in it. */
function editingText(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value.length > 0;
  }
  return target.isContentEditable && (target.textContent ?? "").trim().length > 0;
}

/**
 * Everything that isn't the feed (a thread, a Decision, settings, usage) is
 * its own full view on its own route, over the feed: under the top bar on a
 * desktop, the whole screen on a phone. The feed stays mounted underneath,
 * so going back finds it where it was. Back and Esc return; Esc in a field
 * with text leaves the field first, and anything that handled Esc itself (a
 * menu, a dialog) keeps it.
 */
export function FeedModal({
  label,
  onClose,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (editingText(event.target)) {
        event.target.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="region"
      aria-label={label}
      data-feed-modal=""
      className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-background [transform:translateZ(0)] [--workspace-controls-top:0px] [--workspace-gutter-start:3.25rem] [--workspace-titlebar-content-left:3.25rem] sm:top-[var(--workspace-topbar-height)] sm:border-t sm:border-border"
    >
      {children}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Back"
        className="absolute top-[calc((var(--workspace-topbar-height)-2rem)/2)] left-3 z-50 [-webkit-app-region:no-drag]"
        onClick={onClose}
      >
        <ArrowLeftIcon />
      </Button>
    </div>
  );
}
