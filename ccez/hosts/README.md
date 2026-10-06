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

## Build tools

The script also installs everything the factory's projects build with: Rust,
Go, Java and Kotlin, the Android SDK and NDK, C/C++ toolchains, Python, Node
and bun, .NET, Docker, Kubernetes tools, Blender, ffmpeg and the libraries
Bevy games need. Set `CZ_HOST_TOOLS=0` before the command to skip them.

To add or update the tools on a host that's already set up, run:

```sh
bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh
```

From another machine, quote the path so `~` expands on the host:
`ssh -t b@basement 'bash ~/SWE/czcode/ccez/hosts/build-tools-linux.sh'`.
To leave groups out, set `CZ_TOOLS_SKIP`, for example
`CZ_TOOLS_SKIP="android blender"`.
