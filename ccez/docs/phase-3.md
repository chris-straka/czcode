# P3: Decisions in the cz server

Agents ask the owner through cz itself. ccez-inbox's Worker is shut down.

## Built

- **Contracts** (`packages/contracts/src/decisions.ts`). The ten kinds are
  pick, review, listen, look, read, playtest, rank, pitch, request, and
  timeline. Old inbox kinds map onto these on import.
  - **Items** carry media, options (recommended, reason), timeline steps,
    `blocking`, `default`, `expires_at`, `cost_note`, `resume`, and
    `thread`.
  - **Answers** carry choices, ranks, per-option reactions with "more like
    these", redlines, passage comments, the playtest form, uploads, "redo
    from", "none of these", a comment, and a voice note.
- **`DecisionService`**:
  - Checks answers per kind.
  - Waits by long-poll (`wait`, up to the limit).
  - Applies an item's default when it expires (a 30-second sweeper).
  - Stores media under `decisions-media/`.
  - Keeps history newest first.
  - Stores everything in `cz.sqlite`, separate from upstream's database.
- **Transports:**
  - HTTP group `/api/decisions`, with operate and read scopes.
  - Media served from `/api/decision-media/*` through six-hour HMAC-signed
    URLs, so `<img>`, `<audio>`, and native players load them without
    headers.
  - **MCP tools:** `ask_owner`, `upload_decision_media`,
    `wait_for_decision`, `get_decision`, `decision_history`, and
    `withdraw_decision`. Their descriptions carry the "when to ask" rules,
    and `ask_owner` stamps the calling thread.
  - **CLI:** `cz inbox submit|wait|get|list|history|withdraw`. It
    works on the local store with or without a running server. `wait` exits
    0 when answered, 2 when closed, and 3 on timeout.

## Gate results

- Server, CLI, and MCP tests cover submit validation, every kind's answer
  rules, wait, expiry defaults, media, and CLI exit codes.
- A trial import of the Worker's items into a sandbox home fed the P4
  screenshots. The owner had never answered an item, so there was no real
  import: the import command was removed and the Worker shut down
  (2026-10-05).

## Not done

- An agent submitting one of each kind through MCP inside a live thread.
  The tools are tested against the service, not end to end with a
  provider.
