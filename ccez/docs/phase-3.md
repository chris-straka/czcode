# P3: Decisions in the cz server

Agents ask the owner through cz itself; ccez-inbox's Worker is no longer
needed once its items are imported.

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
  - **CLI:** `cz inbox submit|wait|get|list|history|withdraw|import`. It
    works on the local store with or without a running server. `wait` exits
    0 when answered, 2 when closed, and 3 on timeout.
- **Import:** `cz inbox import` copies inbox.ccez.uk items, answers, and
  media, keeping their ids and times. It skips ids it already has, so it is
  safe to re-run.

## Gate results

- Server, CLI, and MCP tests cover submit validation, every kind's answer
  rules, wait, expiry defaults, media, import, and CLI exit codes.
- A trial import into a sandbox home loaded the Worker's items, which the
  P4 screenshots show. The real import runs at switch-over, once cz owns
  `~/.cz`, because creating it early would skip the `~/.t3` migration.

## Not done

- Comparing imported counts against the Worker's, item for item. Do this at
  the real import, before shutting the Worker down.
- An agent submitting one of each kind through MCP inside a live thread.
  The tools are tested against the service, not end to end with a
  provider.
