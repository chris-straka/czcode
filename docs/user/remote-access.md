# Remote access

Connect a phone, the terminal app, or another desktop app to czcode running on a
different machine. That machine must stay running and reachable while you work.
czcode reaches other machines over Tailscale or your local network; there is no
hosted relay.

## Tailscale

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Connections**. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
cz serve --tailscale-serve
```

For an already-running server, print a pairing link and QR code:

```bash
cz pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

```bash
tailscale serve --https=443 off
```

If that port is already in use, choose another with
`--tailscale-serve-port`. See `cz pair --help` for other pairing options.

To turn a spare Linux or Windows PC, or a Mac account, into an agent host, run the host setup
script from `ccez/hosts` on it. It installs Tailscale and the providers, keeps
`cz serve` running, and prints a pairing link at the end.

## Pair over a LAN

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Connections**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet
address:

```bash
cz serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
cz pair
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Connections**
on desktop, **Settings → Environments** on mobile, and the Hosts tab in
`cz tui`. A loopback address such as `127.0.0.1` reaches only the device opening
the link.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Connections page stays open. If you leave or reload that page, create
another link to share.

### Reach one machine several ways

A machine can have more than one route: LAN, Tailscale, or another address. To
add one, choose **Add route** in the machine's route list. Pairing the same
machine again over another address also adds a route instead of a second
machine. A new route is placed by speed, and you can reorder routes at any time.

While connected, czcode also learns the machine's current LAN and Tailscale
addresses and adds them as routes, so pairing once over Tailscale is enough to
use the LAN at home. When the machine's LAN address changes, for example after
it joins another Wi-Fi network, the learned route follows it. The machine must
allow network access for its LAN address to be learned. You can reorder a
learned route, but not remove it; it goes away with the route it was learned
through, or when the machine stops reporting that address.

czcode connects over the first route that answers. Away from home, a LAN
address that does not answer is checked briefly and skipped. It is only tried
again, after the other routes, if none of them connect. While connected over a
later route, czcode checks the earlier ones when your network changes, when you
return to the app, and every minute, and moves back as soon as one works.

On desktop, select the route count under the machine's name in
**Settings → Connections** to see its routes. Drag a route to change the order,
or remove it. On mobile, open the machine under **Settings → Environments** and
choose **Edit**.

### Balance new threads across machines

Auto balance is off by default. On desktop, enable it in
**Settings → Connections → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments. The section
appears once two or more machines are switched on.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. If resource checks are
unavailable or all eligible machines are full, choose a machine manually to continue.
Mobile and `cz tui` keep manual environment selection.

## Browser on a remote environment

Browser tabs belong to the environment, so you and your agents see the same
tabs from any device. The desktop app shows its own environment's tabs
directly. Every other device, and the desktop app for other environments,
streams them from the host. Agents keep using them while no device is
connected, and `localhost` addresses reach servers on the host.

The first tab downloads a headless Chrome, about 120 MB, into the cz home. It
is the same browser [HTML renders](html-renders.md) use, so a host downloads it
only once. Some Linux hosts need [setup](#browser-host-setup) before it can
start.

Agent tabs have separate storage and share a Chromium process. Take control before
typing into an agent's tab, then release control when you want the agent to
continue. Read-only connections can watch without changing the page.

While you have control, the tab works with your device: text the page copies or
cuts goes to your clipboard, a file picker on the page opens your device's
picker, and a finished download is offered for you to save. Popups such as
sign-in windows open as their own tabs. Downloads stay on the host until the
tab closes. Audio does not play on your device.

On a phone, tap the floating preview's corner dot to show its controls, then
**Pop into separate window** to keep watching in picture-in-picture over other
apps.

### Browser host setup

macOS, Windows, and Linux desktops run the browser as is. Some Linux hosts need
one-time setup: Ubuntu 23.10 and later block the sandbox the browser runs in,
and minimal images and containers lack libraries it loads. When that happens,
the server says so at startup, and browser tabs and HTML previews show the
command to run on the host:

```sh
sudo cz browser setup
```

The server shows the exact line for how you started it, such as
`sudo npx cz browser setup`, and keeps your `PATH` when Node is installed only
for your user. It allows Chrome's sandbox with an AppArmor profile and installs
any missing libraries with apt. It is safe to run again. Without `sudo`, it
only reports what it would change.

The browser always runs in Chrome's sandbox. Where you cannot change the host,
set `CZ_SERVER_BROWSER_SANDBOX=0` for the environment to run without it.

## Connect an outside agent

An agent czcode did not start, such as Claude Code in your own terminal, can
drive threads on an environment through its MCP server. In **Settings →
Connections**, open a saved environment's menu and choose **Copy MCP URL**, then
add it to the agent. For example:

```sh
claude mcp add --transport http cz https://<environment-address>/mcp
```

The first time the agent connects, it opens a sign-in page on the environment.
Enter a pairing code from **Settings → Connections** on a device that can manage
access, or from `cz auth pairing create` on the host, and choose what the agent
may do. A browser already signed in to that environment as an administrator can
approve without a code.

- **Read only** lets the agent read projects and threads in every project, and
  see which providers and models are available. It cannot change anything.
- **Supervised** through **Full access** also let it start, message and stop
  threads in every project, but it cannot start or steer a thread with more
  permissions than the mode you chose.

Use an HTTPS address: cz Connect, Tailscale Serve, or `localhost` on the host
itself. Agents refuse to sign in through a plain `http://` LAN or tailnet
address. The agent appears under **Settings → Connections** like any other
client; revoke it there. Sign-ins last 30 days.

## Manage or revoke access

On the host, **Settings → Connections** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `cz auth --help`.

A session with an open connection stays listed after its access credential
expires.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.

For a connection that still fails after pairing, check the date and time on both
devices, and that both are on the tailnet (`tailscale status`). For server
version warnings, follow [Updating czcode](./updating.md).

## Using the Desktop App as a Remote Only

If a computer should only drive work running elsewhere, turn off its local environment. In the
desktop app, open **Settings → Connections** and switch off **Local
environment**. czcode restarts without a local server: no local agents or terminals run, and other
devices can no longer connect to this computer. Your projects, history, and saved connections are
kept, and you keep working through paired machines.

Switch **Local environment** back on in the same place to restart with your previous local
settings.
