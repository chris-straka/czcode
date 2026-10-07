/**
 * What ct says about a wake, by outcome. An automatic wake (opening a thread
 * on a quiet machine) only speaks when a wake was actually tried; one the
 * user asked for (w) always says what happened and why.
 *
 * @module wake
 */
import type { WakeAttempt } from "@cz/client-runtime/state/hostWake";

export type WakeOutcome<Id> = WakeAttempt<Id> | { readonly kind: "no-address" };

const list = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function wakeMessage<Id>(input: {
  readonly label: string;
  readonly outcome: WakeOutcome<Id>;
  readonly labelOf: (id: Id) => string;
  readonly userInitiated: boolean;
}): string | null {
  const { label, outcome } = input;
  switch (outcome.kind) {
    case "sent":
      return `Waking ${label} through ${input.labelOf(outcome.through)}; it reconnects in about 30 seconds.`;
    case "no-address":
      return input.userInitiated
        ? `${label} has no network address to wake it by (it's this machine's own server).`
        : null;
    case "nothing-to-send-through":
      return input.userInitiated
        ? `Can't wake ${label}: no other machine is connected to send it the wake packet.`
        : null;
    case "failed": {
      const offNetwork = outcome.attempts
        .filter((attempt) => attempt.reason === "off-network")
        .map((attempt) => input.labelOf(attempt.through));
      const errors = outcome.attempts
        .filter((attempt) => attempt.reason === "error")
        .map(
          (attempt) =>
            `${input.labelOf(attempt.through)} failed${attempt.message ? ` (${attempt.message})` : ""}`,
        );
      const why = [
        offNetwork.length > 0
          ? `${list(offNetwork)} ${offNetwork.length === 1 ? "isn't" : "aren't"} on its network or ${offNetwork.length === 1 ? "doesn't" : "don't"} know its address`
          : null,
        ...errors,
      ].filter(Boolean);
      return `Couldn't wake ${label}: ${why.join("; ")}.`;
    }
  }
}
