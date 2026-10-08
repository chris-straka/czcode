# Install czcode

czcode runs coding agents on your computers and lets you control them from its
desktop app, terminal app, or Android app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch czcode and configure providers afterwards.

czcode has no store listing or install site. The Mac app installs from the
repo's GitHub releases and updates itself; everything else is built from a
checkout of this repo.

## Mac desktop app

On an Apple Silicon Mac, quit czcode if it's running, then in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/release/mac-install.sh | sh
```

This installs the newest build of `main` as `/Applications/czcode.app` and puts
`cz` in `~/.local/bin`. That `cz` runs the installed app's own server, so the
command line always matches the app. From then on the app updates itself (see
[Updating czcode](./updating.md#mac-app)).

To try a local change instead, build and install from a checkout with
`ccez/release/mac.sh --install`.

## Another computer as an agent host

A Linux PC, a Windows PC through WSL2 Ubuntu, or a separate account on a Mac
is set up with one script. Follow `ccez/hosts/README.md`: it installs Tailscale, Node, the providers, and
cz built from this repo, keeps `cz serve` running in the background, walks
through each provider sign-in, and prints a pairing link.

## Command line

| Task                                       | Command               |
| ------------------------------------------ | --------------------- |
| Start the server and open the web app      | `cz`                  |
| Start the server without a browser         | `cz serve`            |
| Open the [terminal app](./terminal-app.md) | `cz tui`              |
| Pair a device over Tailscale               | `cz pair --tailscale` |
| Ask the owner, read answers                | `cz inbox`            |
| Run a task at the next quota reset         | `cz queue`            |
| List threads, stop a run                   | `cz thread`           |
| Pair this terminal with a machine          | `cz host add <link>`  |

`cz queue` and `cz thread` act on another machine with `--host <name>`, once
`cz host add` (or the terminal app's Hosts tab) has paired with it. They share
the terminal app's paired machines.

Run `cz help` or `cz --help` for the full reference. To start in a new working
directory, use an explicit path such as `cz ./my-project`. A bare directory name
is accepted only if it already exists.

If `cz` or `cz start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
cz app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `cz app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Android only. Build and install it with the phone on USB:

```bash
ccez/release/android.sh --install
```

After that, `android.sh --publish` offers new builds from the Mac, and the
phone installs them from **Settings → App → Install update** (see
[Updating](./updating.md#mobile-updates)). The phone connects to a server on
another machine; follow [remote access](./remote-access.md) to pair it.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack. Error messages can quote values from the app, so read the
report over before sharing it.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from czcode's provider settings.                                                                                          |
| Pi          | Install [Pi](https://pi.dev), then run `pi` once to finish its login or API-key setup.                                                                    |

Provider CLIs must be on the server's `PATH`. If czcode cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

czcode warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when czcode cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with czcode. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, czcode does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), and [Pi](./providers-pi.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating czcode](./updating.md): update the app and connected servers.
