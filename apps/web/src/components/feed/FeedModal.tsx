import { useEffect, type ReactNode } from "react";

import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * Everything that isn't the feed opens here, over it: a thread, settings,
 * usage, a decision. Large on desktop, full screen on a phone. Esc closes
 * unless something inside (a menu, the composer) handled it first.
 */
export function FeedModal({
  label,
  onClose,
  showClose = true,
  className,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  /** Off when the content brings its own close button. */
  readonly showClose?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" data-feed-modal="">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/55 max-sm:hidden"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          // On desktop the modal sits below the feed's bar, clear of the macOS
          // window buttons, so headers inside it drop that inset; full screen
          // on a phone keeps it.
          "absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background [transform:translateZ(0)] [--workspace-controls-top:0px] [--workspace-controls-right:3.25rem] [--workspace-gutter-end:3.5rem] sm:[--workspace-titlebar-content-left:var(--workspace-gutter-start)] sm:inset-x-[max(1.5rem,calc((100vw-72rem)/2))] sm:top-[var(--workspace-topbar-height)] sm:bottom-4 sm:rounded-xl sm:border sm:border-border sm:shadow-2xl",
          className,
        )}
      >
        {children}
        {showClose ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
            className="absolute top-2.5 right-3 z-50"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
