import { useAtomValue } from "@effect/atom-react";
import { AVAILABLE_CONNECTION_STATE } from "@cz/client-runtime/connection";
import type { EnvironmentId } from "@cz/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { Box, Text, useInput } from "ink";
import { createElement as h, useState } from "react";

import { hostStateLabel } from "../model/hosts.ts";
import type { TuiAtoms } from "../state/atoms.ts";
import { useCommand } from "./command.ts";
import { TextInput } from "./TextInput.ts";

/** Paired machines with their state; `p` pairs a new one from a `cz pair` link. */
export function HostsScreen({
  atoms,
  active,
}: {
  readonly atoms: TuiAtoms;
  readonly active: boolean;
}) {
  const catalog = useAtomValue(atoms.catalog.catalogValueAtom);
  const entries = [...catalog.entries.entries()];
  const [cursor, setCursor] = useState(0);
  const [pairing, setPairing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const pair = useCommand(atoms.pairing);
  const retry = useCommand(atoms.catalog.retryNow);
  const setEnabled = useCommand(atoms.catalog.setEnabled);
  const selected = entries[Math.min(cursor, entries.length - 1)];

  useInput(
    (input, key) => {
      if (input === "p") return setPairing("");
      if (key.downArrow || input === "j") setCursor(Math.min(entries.length - 1, cursor + 1));
      else if (key.upArrow || input === "k") setCursor(Math.max(0, cursor - 1));
      else if (input === "r" && selected) void retry(selected[0]);
      else if (input === "e" && selected) {
        void setEnabled({ environmentId: selected[0], enabled: !selected[1].enabled });
      }
    },
    { isActive: active && pairing === null },
  );
  useInput(
    (_input, key) => {
      if (key.escape) setPairing(null);
    },
    { isActive: active && pairing !== null },
  );

  return h(
    Box,
    { flexDirection: "column" },
    entries.length === 0
      ? h(Text, { dimColor: true }, "No hosts yet. Press p to pair one.")
      : entries.map(([environmentId, entry], index) =>
          h(HostRow, {
            key: environmentId,
            atoms,
            environmentId,
            label: entry.target.label,
            enabled: entry.enabled,
            selected: index === cursor,
          }),
        ),
    pairing === null
      ? h(Text, { dimColor: true }, note || "p pair · r retry · e enable/disable")
      : h(
          Box,
          { flexDirection: "column", marginTop: 1 },
          h(Text, null, "Paste the link from `cz pair --tailscale` on the host (esc cancels):"),
          h(TextInput, {
            value: pairing,
            active,
            placeholder: "https://host.tailnet.ts.net/pair#token=…",
            onChange: setPairing,
            onSubmit: (value) => {
              const pairingUrl = value.trim();
              if (!pairingUrl) return;
              setPairing(null);
              setNote("Pairing…");
              void pair({ pairingUrl }).then((environmentId) =>
                setNote(environmentId ? "Paired." : ""),
              );
            },
          }),
        ),
  );
}

function HostRow(props: {
  readonly atoms: TuiAtoms;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly enabled: boolean;
  readonly selected: boolean;
}) {
  const result = useAtomValue(props.atoms.catalog.stateAtom(props.environmentId));
  const state = Option.getOrElse(AsyncResult.value(result), () => AVAILABLE_CONNECTION_STATE);
  const label = hostStateLabel(state, props.enabled);
  const color = label === "online" ? "green" : label.startsWith("blocked") ? "red" : "yellow";
  return h(
    Box,
    null,
    h(Text, { color: "cyan" }, props.selected ? "› " : "  "),
    h(
      Box,
      { width: 20, marginRight: 1 },
      h(Text, { bold: props.selected, wrap: "truncate" }, props.label),
    ),
    h(Box, { flexGrow: 1 }, h(Text, { color, wrap: "truncate" }, label)),
  );
}
