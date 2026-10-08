import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { ProviderUpdateRunRow } from "./ProviderUpdateLaunchNotification.logic";
import { Spinner } from "./ui/spinner";

/** One line per provider update: running, what changed, or why it failed. */
export function ProviderUpdateRunRows({
  rows,
}: {
  readonly rows: ReadonlyArray<ProviderUpdateRunRow>;
}) {
  return (
    <div className="mt-0.5 flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.key} className="flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0">
            {row.state === "running" ? (
              <Spinner size="sm" tone="muted" />
            ) : row.state === "updated" ? (
              <CheckIcon aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <XIcon aria-hidden="true" className="size-3.5 text-destructive" />
            )}
          </span>
          <span className={cn("min-w-0", row.state === "failed" && "text-destructive")}>
            {row.text}
          </span>
        </div>
      ))}
    </div>
  );
}
