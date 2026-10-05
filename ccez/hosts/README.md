# Set up a computer as a cz agent host

**Windows, first time only:** open PowerShell, run `wsl --install`, restart,
open **Ubuntu** from the Start menu, and pick a username and password.

Then paste this into the Ubuntu terminal (right-click pastes):

```sh
curl -fsSL https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh -o /tmp/cz-host.sh && bash /tmp/cz-host.sh
```

It installs Tailscale, cz, Claude Code, Codex, and OpenCode, and keeps cz
running in the background. It walks you through each sign-in, then prints a
pairing link to open in czcode on your other devices. Run it again any time to
update cz.

- **Claude:** sign in with this computer's browser. Claude shows a code to
  paste back into the terminal.
- **Codex and GitHub:** open the link on any device and enter the code.
- **OpenCode:** skip it. The Mac copies its login here over Tailscale.
