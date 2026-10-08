# Decisions in cz: what agents can ask the owner, and when

Design, 2026-10-04. Replaces the "Inbox tab = port the PWA" idea in
`PLAN.md`. Backend: a decision service in the cz server (czcode is the
inbox; ccez-inbox's items are imported once and its Worker retired), with
MCP tools and a `cz inbox` CLI, as below.

## Look and feel

Use **T3's design system** (its components, themes, fonts, light/dark, and
navigation) so the Decisions tab feels like the rest of the app and picks up
upstream UI improvements. Don't port the inbox PWA's Darkroom styling or its
self-hosted font. Do keep these interaction ideas from Darkroom (branch
`darkroom-redesign-wip` in ccez-inbox):

- **Filter chips** by project and type at the top of the feed.
- **Cards that fit the type:** approve/reject right on the card for Review
  and Pitch (plus swipe), an Install button on Playtest cards, option
  thumbnails on Pick cards, so many decisions never need opening.
- **Picture tiles** for image options (big, tappable, label underneath).
- **Sticky answer panel:** the answer buttons stay pinned at the bottom
  while the owner scrolls through the media.
- **Answered card:** after deciding, the item shows what was chosen and the
  note, with undo for a short while.
- **Loading skeletons** instead of spinners.
- The **monochrome notification badge** idea, for when push arrives (P9).

## Two places for the owner's attention

|          | **Threads** (T3 as it is)                              | **Decisions** (new)                                                               |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| What     | A live conversation with one agent on one task         | A judgment call with media, from any project, that waits for the owner            |
| Agent    | Usually blocked until the owner replies                | Usually not blocked: it moves on or ends, and work resumes when the owner answers |
| Media    | Text, simple multiple choice, files the owner attaches | Images, 3D, audio sets, video, builds, long text, made for judging                |
| Lifetime | The thread's lifetime                                  | Kept forever as the owner's taste history                                         |

A thread stuck on a decision shows a chip that opens it; a decision links
back to its thread.

## What agents can ask (decision types)

Each type has its own full-screen view. Every type has a free-text note and a
voice note, plus **"none of these, try again"** with a note.

1. **Pick:** choose one (or several, if the agent allows) from options that
   can be images, 3D models, sounds, or clips. Example: 4 Andras concepts.
2. **Review:** one artifact; approve, reject, or ask for changes. On images
   the owner can **draw on it** (redline) and circle areas. Example: a level
   blockout render, a turnaround sheet.
3. **Listen:** a board of sound variants (instead of A/B). Each row plays on
   tap, loops on long-press, and gets keep / kill / favourite plus an
   optional note ("too retro", "more metal"). **"More like these"** sends the
   kept ones back to the agent for another round. Optional **in context**:
   play the sound over a gameplay clip, or the music under one. Example: 8
   sword whooshes from synthforge.
4. **Look:** a full-screen 3D view: orbit and zoom, animation picker,
   textured / clay / wireframe toggle, a human-height scale figure, the
   pose-test sheet, and side-by-side with a second model. Pick, review, and
   timeline items open it for any 3D option. Example: Tripo result for the
   brute.
5. **Read:** long text (story drafts, dialogue, zone briefs, video scripts)
   with comments on any selected passage, then approve or send back. Example:
   an agent-sorted draft of the First Invasion.
6. **Playtest:** install a build (APK button), play, then a short form: what
   felt good, what felt bad, bugs, a voice note. Example: HLL B2 on the S24.
7. **Rank:** drag options into order. Example: name candidates, zone order.
8. **Pitch:** an idea from an agent: yes / later / never, with a note. "Yes"
   becomes a queued task.
9. **Request:** an agent needs something only the owner can supply: a zone
   brief, a sketch, a reference photo, a voice memo. Upload, type, or record.
   Example: "Andras needs a concept image before the Tripo test."
10. **Timeline:** a genforge production run (genforge P7), one strip of steps
    (concept → views → model → rig → checks → pose test), each one viewable
    with **"redo from here"** and a note.

## Every decision also carries

- `project` and, when it came from a thread, `thread` (deep link).
- `blocking`: whether an agent is waiting on it right now.
- `default` + `expires_at` (optional): "if no answer by Friday, I'll go with
  B." Keeps work moving when the owner is busy. Never used for anything that
  spends money or publishes.
- `cost_note` (optional): what answering yes will spend ("runs Tripo, about
  $0.40").
- `resume`: how work continues after the answer (see below).
- `target_device` (optional): `phone`, `desktop`, or `any`. A playtest that
  ships an app build defaults to `phone`; everything else to `any`. Each
  client shows its own device's decisions and folds the rest into one quiet
  line ("3 waiting on your phone").

## When agents should ask (rules for every agent)

Ask when:

- It's a **taste call**: art, animation, sound, music, story, names, game
  feel, UI look.
- It **spends money** or is **outward-facing** (publishing, deploying,
  deleting).
- The options are **materially different directions**, and a wrong guess
  would waste real work.
- A **batch finished** that needs judging (a genforge round, a synthforge
  round, a set of level variants).
- Only the owner has the input (Request).

Don't ask when:

- A sensible default exists for a technical choice: decide, and log it in
  the repo's `docs/decisions.md`.
- It's a status update: that belongs in the thread.
- A check could answer it (tests, rfcheck, weightforge, screenshots).

How to ask:

- **Batch:** one Listen with 8 sounds, not 8 decisions. At most ~5 open
  decisions per project; further ones wait in the agent's queue.
- **Don't block if anything else can be done.** Submit, then continue other
  work or end the thread with a resume plan.
- Give a recommendation when there is one (marked on the option), and say
  why in one line.
- Start with a one-line question that says exactly what is being chosen.
- Each option gets its own distinct image (for a video: a thumbnail mock of
  that video), or no option gets one. Never attach the same image to every
  option: the owner can't tell the options apart (owner feedback,
  2026-10-07). Shared context goes in the body or `context_media_idx`.
- To judge a video, show the finished video (or a playable draft), not a
  plan or a summary card. Nothing is published without the owner.
- Render every option the same way and at the same size: an image of the
  same dimensions for each, or none. Clients frame option media at one
  aspect ratio, and `ask_owner` / `cz inbox submit` warn when only some
  options have media.

## When the owner sees them (no push for now)

- The **Decisions** tab badge shows the open count. Order: blocking first,
  then project priority (HLL first), then oldest.
- **Review session:** one button that walks through every open decision
  full-screen, one after another, so ten minutes clears the queue.
- The Threads list marks threads that have an open decision.
- No push notifications or daily digest (dropped from the plan 2026-10-05).

## After the owner answers

- **The agent is still waiting** (`blocking`): it gets the answer through
  `cz inbox wait` (or the MCP wait tool) and continues.
- **The agent has moved on or ended:** the cz server sees the answer and
  starts a **resume thread** in the same project with the decision, the
  owner's note, and the agent's resume prompt attached. If quotas are spent,
  the resume goes into the reset queue.
- **Taste history:** every decision, pick, and note is stored and searchable
  by agents (`cz inbox history --project hll --kind listen`). genforge's judge
  and every agent read it before proposing ("the owner rejected retro
  sounds for HLL; avoid square-wave tails"). Over time agents ask fewer
  questions because they know the owner's taste.

## Reset queue ("run when my quota resets")

T3 has no scheduler. nightshift's queue moves into the cz server, which
already tracks each provider's quota and reset time:

- **"Run at next reset"** on the send button: the run waits in the queue and
  becomes a thread when the chosen provider's window resets (or when spare allowance
  would expire unused).
- The queue shows on T3's existing **Usage → Limits** page, next to each
  provider's reset countdown.
- Resume threads from answered decisions use the same queue when quotas
  are out.

## What gets dropped

- The inbox's **fleet panel**: T3 already has threads, Usage → Limits
  (quotas, reset countdowns), and load balancing across machines. The queue
  part moves to Usage → Limits as above.
- The inbox **PWA**, once the Decisions tab covers every type above.

## Backend (decision service in the cz server)

- New kinds: `review`, `listen`, `look`, `read`, `playtest`, `request`,
  `timeline` (existing `pick`, `approve` → `review`, `rank`, `freeform` →
  `request`, `build` → `playtest`, `trend` → `pitch`, with a migration).
- Per-option reactions (keep / kill / favourite / note) for Listen; image
  redline storage for Review; passage comments for Read; uploads for Request.
- Fields: `blocking`, `default`, `expires_at`, `cost_note`, `resume`
  (`{thread_id?, project, prompt, provider?}`), `thread`.
- `cz inbox history` (CLI + MCP) for taste lookup; the server itself finds
  answered items whose agent moved on and starts their resume threads.
- MCP tool descriptions carry the "when to ask" rules above, so every agent
  sees them at the moment it's about to ask.
