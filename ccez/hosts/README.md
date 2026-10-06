# Set up a computer as a cz agent host

**Windows, first time only:** open PowerShell, run `wsl --install`, restart,
open **Ubuntu** from the Start menu, and pick a username and password.
**A PC running Ubuntu itself:** open Terminal.

Then paste this into the terminal (right-click pastes):

```sh
wget -qO /tmp/cz-host.sh https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh && bash /tmp/cz-host.sh
```

It installs Tailscale, cz, Claude Code, Codex, and OpenCode, and keeps cz
running in the background. It walks you through each sign-in, then prints a
pairing link to open in czcode on your other devices. Run it again any time to
update cz.

- **Claude:** sign in with this computer's browser. Claude shows a code to
  paste back into the terminal.
- **Codex and GitHub:** open the link on any device and enter the code. For
  Codex, first turn on "Enable device code sign-in for Codex" in ChatGPT's
  settings.
- **OpenCode:** skip it. The Mac copies its login here over Tailscale.

## Build tools (optional, for game and tool builds)

For a host that builds the factory's projects (Bevy games, Android APKs,
Blender jobs, media tools), run this afterwards. It asks for your password
once and is safe to re-run:

```sh
bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh
```
