# Updating czcode

The app you use and the server running your agents can be on different machines.
When a server is behind your web or desktop app, an update notice appears in the
conversation and **Settings → Connections**. Update the machine named in that
notice.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → General → Continue threads after restarts** is off by default.
Enable it to resume supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
czcode must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
If you previously enabled continuation for updates, enable this setting once
to allow recovery without a connected client.

Updates from the previous orchestration system preserve conversation transcripts but cannot carry
every kind of runtime history forward. Read [Threads from older czcode versions](./thread-migration.md)
before continuing an important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  czcode on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

## Update a connected server

czcode has no release downloads, so every machine updates by rebuilding from
this repo's `main`. The in-app **Update server** and `cz update` look for
releases and find none.

- **Mac:** quit czcode, pull `main`, and run `ccez/release/mac.sh --install`.
- **Agent hosts:** run the host setup script again on the host. It pulls
  `main`, rebuilds, and restarts the `cz-host` service.

Updating restarts that machine's server, so let active turns finish first.

## Update providers

**Settings → Providers** opens on **All machines**: one grid of every provider on every
connected machine, showing whether it's signed in, its version, and whether an update is waiting.
Select a cell, or pick a machine in the header, to change that machine's provider.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

## Mobile updates

From your phone, open **Settings → Environments** and select a machine to
refresh provider status and update supported providers. These controls require
a connected environment and permission to operate it. Provider update checks
and restart continuation preferences are in **Settings → Maintenance**.

On Android, a paired machine can offer its own newer build: **Settings → App →
Install update** appears when one has an APK newer than yours. Tapping it
downloads the update in the app and opens Android's installer; tap **Update**.
The first time, Android asks you to allow czcode to install apps.
