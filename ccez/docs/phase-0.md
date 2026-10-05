# P0: name and launcher icon

Gate: the owner's icon pick is recorded. **Waiting on the owner.**

- App name: **czcode** (decided in the plan).
- Four plain, letter-free options went to the inbox as a pick on
  2026-10-04 (item `f1f7d864-7dcb-4c1c-b394-338ad26ca354`, project
  `czcode`): Dot, Ring, Two lines, Half.

  ![options](img/p0-options.jpg)

- **Placeholder in use: Dot.** Every surface already carries it (see
  phase-1). The pick becomes one command:

  ```bash
  ccez/brand/apply.sh <dot|ring|bars|half>
  ```

  It renders iOS/macOS/Linux/Windows/web icons, the Icon Composer
  projects, Android adaptive, monochrome, and notification icons, and blank
  splash images, with one quiet tile colour per build variant (release
  `#141414`, dev `#1E2833`, nightly `#2B2433`).

- One identity config: `identity` at the top of `ccez/rename/map.ts`
  (app name, CLI name, GitHub owner, org, reverse-DNS prefix, domain).
  Every renamed name (bundle ids `uk.ccez.cz[.dev|.preview]`, package
  scope `@cz/*`, `~/.cz`, `CZ_*`, hostnames, the update repository) is
  derived from it, so changing a value and re-running the codemod changes
  it everywhere without hand edits to upstream files.
- Deviation: URL schemes are `czcode://` / `czcode-dev://`, not `cz://`.
  The scheme string is shared with window classes and data-directory
  names upstream; splitting them needs rules with context the codemod
  doesn't have.
