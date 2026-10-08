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

## Mac app

Every change to `main` becomes a new Mac build once CI finishes building it. The app checks
for one when it starts, every few minutes after that, and when you click the
update button: the round button next to **Back** at the bottom left of
Settings, or the button on the version row in Settings. Hover the button to see
where things stand: **Up to date**, **Updating**, or **Restart to update**.

A new build downloads by itself. It installs when no agent is working and
nothing queued is due within 10 minutes, or when you quit czcode, or right away
if you click **Restart to update**. czcode then reopens on the new version. If
an update fails, the button says why in one sentence and the current version
keeps running; click it to try again.

## Update a connected server

- **Mac:** the server is part of the app, so updating the app updates it
  (**Update server** in the app does the same).
- **Agent hosts:** they rebuild `main` every night and restart once idle. To
  update now, run the host setup script again on the host. It pulls `main`,
  rebuilds, and restarts the `cz-host` service.

Updating restarts that machine's server, so let active turns finish first.

## Update providers

**Settings → Providers** opens on **All machines**: one grid of every provider on every
connected machine, showing whether it's signed in, its version, and whether an update is waiting.
Select a cell, or pick a machine in the header, to change that machine's provider.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

When a provider release comes out, a notice lists the machines that are behind. Its **Update**
does the same as **Update all**, shows each machine's progress, and ends with one line per machine
saying what changed or why it failed.

## Mobile updates

From your phone, open **Settings → Environments** and select a machine to
refresh provider status and update supported providers. These controls require
a connected environment and permission to operate it. Provider update checks
and restart continuation preferences are in **Settings → Maintenance**.

On Android, a paired machine can offer its own newer build: **Settings → App →
Install update** appears when one has an APK newer than yours. Tapping it
downloads the update in the app and opens Android's installer; tap **Update**.
The first time, Android asks you to allow czcode to install apps.
