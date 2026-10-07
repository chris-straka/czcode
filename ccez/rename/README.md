# The rename

Every T3 name becomes a cz name through one codemod, never by hand, so
upstream T3 Code merges into czcode pre-renamed.

- `map.ts`: the rules (T3 name → cz name), the files the codemod skips, and
  the upstream paths main has dropped.
- `rename.ts`: applies the rules to a checkout's tracked files and paths.
  Deterministic. Rewrites `pnpm-lock.yaml` patch hashes when it changes a
  patch file.
- `check`: fails if any T3 name is left outside the allowlist. Run it before
  committing anything that came from upstream.
- `sync.sh`: regenerates the `upstream-cz` branch from `upstream/main` and
  merges it into `main`.

When upstream adds a T3 name the rules get wrong, fix the rule in `map.ts`,
not the output. Fork-only code is written with cz names from the start.

Two choices that look like misses but are deliberate:

- URL schemes are `czcode://` (dev `czcode-dev://`), not `cz://`: the scheme
  string is shared with window classes and data-directory names, and
  splitting them needs context the rules don't have.
- `packages/shared/src/legacyNames.ts` keeps the old names on purpose: it
  reads `T3CODE_*` env vars, `~/.t3`, and `t3.json` once, to migrate them.

CI: the rules also map upstream's Blacksmith runner labels to GitHub-hosted
runners. Workflows that need upstream-only secrets are disabled on the fork
by `ccez/ci/disable-upstream-workflows.sh`; rerun it if a sync adds another.
