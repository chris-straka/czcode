# Sets up a Windows PC as a cz agent host: WSL2 with Ubuntu (systemd on, kept
# running after you log in), then runs linux.sh inside it for Tailscale, cz,
# and the Claude, Codex, and OpenCode logins. Safe to re-run.
#
# In an administrator PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass
#   irm https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/windows.ps1 | iex
#
# If Windows needs a restart after installing WSL, it says so: restart and run
# the same command again.
$ErrorActionPreference = "Stop"
$Distro = "Ubuntu"
$LinuxScript = "https://raw.githubusercontent.com/chris-straka/czcode/main/ccez/hosts/linux.sh"
$env:WSL_UTF8 = "1"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this in an administrator PowerShell." }

Step "WSL2 and $Distro"
$distros = (& wsl.exe --list --quiet 2>$null) -join "`n"
if ($LASTEXITCODE -ne 0 -or $distros -notmatch "(?m)^$Distro\s*$") {
  & wsl.exe --install --distribution $Distro --no-launch
  $distros = (& wsl.exe --list --quiet 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $distros -notmatch "(?m)^$Distro\s*$") {
    Write-Host "WSL is installed but Windows needs a restart. Restart, then run this again." -ForegroundColor Yellow
    return
  }
}
& wsl.exe --set-default $Distro

Step "Linux user"
$linuxUser = (& wsl.exe -d $Distro -- whoami).Trim()
if ($linuxUser -eq "root") {
  $linuxUser = Read-Host "Pick a Linux username (lowercase, e.g. $($env:USERNAME.ToLower()))"
  & wsl.exe -d $Distro -u root -- useradd --create-home --groups sudo --shell /bin/bash $linuxUser
  Write-Host "Set a password for $linuxUser (sudo asks for it):"
  & wsl.exe -d $Distro -u root -- passwd $linuxUser
}

Step "systemd and default user"
# Written by printf inside Linux so the file gets Unix line endings.
$current = (& wsl.exe -d $Distro -u root -- cat /etc/wsl.conf 2>$null) -join "`n"
if ($current -notmatch "systemd=true" -or $current -notmatch "default=$linuxUser") {
  & wsl.exe -d $Distro -u root -- sh -c "printf '[boot]\nsystemd=true\n\n[user]\ndefault=%s\n' '$linuxUser' > /etc/wsl.conf"
  & wsl.exe --terminate $Distro | Out-Null
}

Step "Keep WSL running after you log in"
# WSL stops its VM when nothing runs in it; this idle process keeps cz up.
$action = New-ScheduledTaskAction -Execute "conhost.exe" `
  -Argument "--headless wsl.exe -d $Distro --exec /bin/sleep infinity"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "cz WSL keepalive" -Action $action -Trigger $trigger `
  -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "cz WSL keepalive"

Step "Tailscale, cz, and agent logins (inside $Distro)"
& wsl.exe -d $Distro -u $linuxUser -- bash -lc "curl -fsSL $LinuxScript -o /tmp/cz-host.sh && bash /tmp/cz-host.sh"
