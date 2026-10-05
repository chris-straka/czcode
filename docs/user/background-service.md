# Running czcode in the background

A machine's agents run only while its czcode server does.

## Mac

The desktop app is the Mac's server. Keep it open, and keep the Mac logged in
and awake for remote access; the display can sleep and the screen can lock. To
start it at login, add czcode in **System Settings → General → Login Items**.

If agent work cannot access Desktop, Documents, or Downloads, give czcode Full
Disk Access in **System Settings → Privacy & Security**.

## Agent hosts

The host setup script (`ccez/hosts`) runs `cz serve` as the systemd user
service `cz-host`, on the tailnet through Tailscale Serve. Lingering is
enabled, so it starts at boot and keeps running after you log out.

| Task                 | Command                            |
| -------------------- | ---------------------------------- |
| Status               | `systemctl --user status cz-host`  |
| Log                  | `journalctl --user -u cz-host -e`  |
| Restart              | `systemctl --user restart cz-host` |
| Stop until next boot | `systemctl --user stop cz-host`    |
| Update cz            | Run the host setup script again    |

On Windows, the script also keeps WSL running after you log in to Windows and
turns off sleep while plugged in. WSL starts only after a Windows login, so a
PC that restarts (for example after Windows Update) needs someone to log in, or
automatic sign-in, before its agents come back.

`cz service`, `cz update`, and `cz uninstall` manage downloaded releases, which
czcode doesn't publish, so they don't apply.

## Troubleshooting

If the service stops when your SSH session closes, check lingering:

```sh
loginctl show-user "$(id -un)" --property=Linger
```

and enable it with `sudo loginctl enable-linger "$(id -un)"`. Run only that
command with sudo; running czcode as root creates a separate installation.

For connection failures, see
[remote access](./remote-access.md#manage-or-revoke-access).
