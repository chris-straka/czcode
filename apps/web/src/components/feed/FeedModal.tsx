import { useEffect, useRef, type ReactNode } from "react";

import { ArrowLeftIcon } from "lucide-react";

import { mainScroller, typingTarget, useVimKeys, vimScrollDistance } from "~/hooks/useVimKeys";
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
 * menu, a dialog) keeps it. j/k scroll, gg and G jump to the top and bottom.
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const scroller = () => {
    const cached = scrollerRef.current;
    if (cached?.isConnected && cached.scrollHeight > cached.clientHeight) return cached;
    scrollerRef.current = mainScroller(rootRef.current);
    return scrollerRef.current;
  };
  useVimKeys({
    move: (direction, size) => {
      const element = scroller();
      if (element) element.scrollBy({ top: direction * vimScrollDistance(size, element) });
    },
    top: () => scroller()?.scrollTo({ top: 0 }),
    bottom: () => {
      const element = scroller();
      element?.scrollTo({ top: element.scrollHeight });
    },
    back: onClose,
  });
  // Space plays or pauses the view's first clip or sound, like a media player;
  // on a button or link it keeps its usual meaning.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (typingTarget(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("button, a, [role=button], [role=slider]")
      )
        return;
      const media = rootRef.current?.querySelector<HTMLMediaElement>("video, audio");
      if (!media) return;
      event.preventDefault();
      if (media.paused) void media.play().catch(() => {});
      else media.pause();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    // The composer's editor claims Esc even when empty; an empty one has no
    // menu open, so Esc there leaves the view before the editor sees it.
    const onCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.isContentEditable &&
        (target.textContent ?? "").trim() === "" &&
        rootRef.current?.contains(target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Claimed, so a view's own Esc handler doesn't close a second time.
      event.preventDefault();
      if (editingText(event.target)) {
        event.target.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
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
