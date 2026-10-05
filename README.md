# czcode

One app for running coding agents and answering what they ask. Agent
threads and decisions with media (picks, reviews, sound boards, 3D, builds)
live side by side on the phone (Android), the Mac (desktop app), and in any
browser. Each machine runs the `cz` server; devices reach it over Tailscale.
Nothing goes through a hosted service, and no usage data is collected.

Works with the agent CLIs already signed in on the machine: Claude Code,
Codex, Cursor, Grok Build, OpenCode, and Antigravity.

## Install from source

Needs Node 24+ and [Vite+](https://viteplus.dev) (`vp`).

```bash
git clone https://github.com/chris-straka/czcode && cd czcode
vp i
vp run --filter @cz/web --filter cz build
ln -sf "$PWD/apps/server/dist/bin.mjs" ~/.local/bin/cz
```

Then:

- `cz serve` starts the server and opens the web app.
- `cz serve --tailscale-serve` also serves it on your tailnet;
  `cz pair --tailscale` prints a pairing link and QR code for the phone.
- `cz service install` keeps the server running in the background.

The first run copies the data directory of an earlier install to `~/.cz`, so
threads and settings carry over; the old directory is left untouched.

## Working on it

- `vp run dev` runs the server and web app against a worktree-local `.cz`.
- `ccez/PLAN.md` is the build plan; `ccez/DECISIONS.md` designs the
  Decisions tab.
- The upstream project is merged in weekly, pre-renamed by the codemod in
  `ccez/rename/` (see its README).

## License

MIT. czcode is a modified fork; see [NOTICE](NOTICE) and [LICENSE](LICENSE).
