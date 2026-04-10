[CmdletBinding()]
param(
  [ValidateSet("start", "stop", "status", "logs", "screenshot")]
  [string]$Action = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve repository root. Run this script inside the repository."
}
$repoRoot = $repoRoot.Trim()

$runtimeRoot = Join-Path $repoRoot ".runtime\multipass"
$imageDir = Join-Path $runtimeRoot "images"
$cloudInitPath = Join-Path $runtimeRoot "cloud-init.yaml"
$imagePath = Join-Path $imageDir "ubuntu-24.04-server-cloudimg-amd64.img"
$screenshotPath = Join-Path $runtimeRoot "firefox-screen.png"

$instanceName = "cbe-debug-generic"
$guestRepoPath = "/home/ubuntu/cbe"
$guestDisplay = ":101"
$guestVncPort = 5902
$guestNoVncPort = 6082
$imageUrl = "https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img"
$legacySshDir = Join-Path $repoRoot ".runtime\hyperv\ssh"
$sshDir = if (Test-Path -LiteralPath (Join-Path $legacySshDir "id_ed25519")) { $legacySshDir } else { Join-Path $runtimeRoot "ssh" }
$sshKeyPath = Join-Path $sshDir "id_ed25519"
$sshPubPath = "$sshKeyPath.pub"

function Resolve-CommandPath {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$Fallback
  )

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  if ($resolved) {
    return $resolved
  }
  if ($Fallback -and (Test-Path -LiteralPath $Fallback)) {
    return $Fallback
  }
  throw "Unable to find required executable: $Command"
}

$multipassPath = Resolve-CommandPath -Command "multipass" -Fallback "C:\Program Files\Multipass\bin\multipass.exe"
$sshPath = Resolve-CommandPath -Command "ssh"
$scpPath = Resolve-CommandPath -Command "scp"
$sshKeygenPath = Resolve-CommandPath -Command "ssh-keygen"

function Ensure-MultipassService {
  $service = Get-Service -Name "Multipass" -ErrorAction SilentlyContinue
  if (-not $service) {
    return
  }
  if ($service.Status -ne "Running") {
    Start-Service -Name "Multipass"
  }
}

function Invoke-Multipass {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [switch]$AllowFailure
  )

  Ensure-MultipassService

  $attempts = 0
  do {
    $attempts++
    $output = & $multipassPath @Args 2>&1
    if ($LASTEXITCODE -eq 0) {
      return $output
    }

    $message = ($output | Out-String).Trim()
    $shouldRetry = $message -match "cannot connect to the multipass socket|grpc_wait_for_shutdown_with_timeout"
    if ($shouldRetry -and $attempts -lt 4) {
      Start-Sleep -Seconds 2
      continue
    }

    if (-not $AllowFailure) {
      throw "multipass $($Args -join ' ') failed.`n$message"
    }
    break
  }
  while ($true)

  return $output
}

function Get-InstanceListText {
  return (Invoke-Multipass -Args @("list") -AllowFailure:$false | Out-String)
}

function Test-InstanceExists {
  $list = Get-InstanceListText
  return $list -match "(?m)^$([regex]::Escape($instanceName))\s"
}

function Get-InstanceInfoText {
  return (Invoke-Multipass -Args @("info", $instanceName) -AllowFailure:$false | Out-String)
}

function Get-InstanceState {
  $info = Get-InstanceInfoText
  if ($info -match "(?m)^State:\s+(.+)$") {
    return $Matches[1].Trim()
  }
  return ""
}

function Get-InstanceIp {
  $info = Get-InstanceInfoText
  if ($info -match "(?m)^IPv4:\s+(.+)$") {
    $ip = $Matches[1].Trim()
    if ($ip -ne "--" -and -not [string]::IsNullOrWhiteSpace($ip)) {
      return $ip
    }
  }
  return ""
}

function Ensure-SshKey {
  New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
  if ((Test-Path -LiteralPath $sshKeyPath) -and (Test-Path -LiteralPath $sshPubPath)) {
    return
  }

  & $sshKeygenPath -q -t ed25519 -N "" -f $sshKeyPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate SSH key at $sshKeyPath"
  }
}

function Write-CloudInit {
  $pubKey = (Get-Content -LiteralPath $sshPubPath -Raw).Trim()
  $cloudInit = @"
#cloud-config
package_update: true
packages:
  - openssh-server
users:
  - default
ssh_authorized_keys:
  - $pubKey
runcmd:
  - mkdir -p /home/ubuntu/.ssh
  - bash -lc "printf '%s\n' '$pubKey' >> /home/ubuntu/.ssh/authorized_keys"
  - chown -R ubuntu:ubuntu /home/ubuntu/.ssh
  - chmod 700 /home/ubuntu/.ssh
  - chmod 600 /home/ubuntu/.ssh/authorized_keys
  - systemctl enable ssh
  - systemctl restart ssh || systemctl restart sshd || true
"@

  Set-Content -LiteralPath $cloudInitPath -Value $cloudInit -NoNewline
}

function Ensure-BaseImage {
  New-Item -ItemType Directory -Force -Path $imageDir | Out-Null
  if (Test-Path -LiteralPath $imagePath) {
    return
  }
  Invoke-WebRequest -Uri $imageUrl -OutFile $imagePath -UseBasicParsing
}

function Ensure-Instance {
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  Ensure-SshKey
  Write-CloudInit
  Ensure-BaseImage
  Invoke-Multipass -Args @("set", "local.privileged-mounts=true") | Out-Null

  if (-not (Test-InstanceExists)) {
    $imageUri = [System.Uri]::new($imagePath).AbsoluteUri
    Invoke-Multipass -Args @(
      "launch",
      $imageUri,
      "--name", $instanceName,
      "--cpus", "2",
      "--memory", "4G",
      "--disk", "20G",
      "--cloud-init", $cloudInitPath,
      "--timeout", "600"
    ) | Out-Null
  }
  elseif ((Get-InstanceState) -ne "Running") {
    Invoke-Multipass -Args @("start", $instanceName) | Out-Null
  }
}

function Wait-ForSsh {
  $deadline = (Get-Date).AddMinutes(5)
  do {
    $ip = Get-InstanceIp
    if ($ip) {
      & $sshPath `
        -o StrictHostKeyChecking=no `
        -o UserKnownHostsFile=NUL `
        -o LogLevel=ERROR `
        -o ConnectTimeout=10 `
        -i $sshKeyPath `
        "ubuntu@$ip" `
        "true" | Out-Null
      if ($LASTEXITCODE -eq 0) {
        return $ip
      }
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for SSH access to $instanceName"
}

function Ensure-RepoMount {
  $info = Get-InstanceInfoText
  if ($info -match [regex]::Escape("$repoRoot => $guestRepoPath")) {
    return
  }

  $output = Invoke-Multipass -Args @("mount", $repoRoot, "${instanceName}:$guestRepoPath") -AllowFailure
  if ($LASTEXITCODE -ne 0) {
    $message = ($output | Out-String)
    if ($message -notmatch "already mounted") {
      throw "Failed to mount repository into guest.`n$message"
    }
  }
}

function Invoke-GuestScript {
  param([Parameter(Mandatory = $true)][string]$Script)

  $ip = Wait-ForSsh
  $tempPath = [System.IO.Path]::GetTempFileName()
  $guestTempPath = "/tmp/cbe-agent-script.sh"
  try {
    $normalizedScript = $Script -replace "`r`n", "`n" -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempPath, $normalizedScript, $utf8NoBom)
    & $scpPath `
      -o StrictHostKeyChecking=no `
      -o UserKnownHostsFile=NUL `
      -o LogLevel=ERROR `
      -i $sshKeyPath `
      $tempPath `
      "ubuntu@${ip}:$guestTempPath"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to upload guest script."
    }

    & $sshPath `
      -o StrictHostKeyChecking=no `
      -o UserKnownHostsFile=NUL `
      -o LogLevel=ERROR `
      -o ConnectTimeout=10 `
      -i $sshKeyPath `
      "ubuntu@$ip" `
      "bash $guestTempPath"
    if ($LASTEXITCODE -ne 0) {
      throw "Guest command failed."
    }
  }
  finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Copy-FromGuest {
  param(
    [Parameter(Mandatory = $true)][string]$GuestPath,
    [Parameter(Mandatory = $true)][string]$HostPath
  )

  $ip = Wait-ForSsh
  & $scpPath `
    -o StrictHostKeyChecking=no `
    -o UserKnownHostsFile=NUL `
    -o LogLevel=ERROR `
    -i $sshKeyPath `
    "ubuntu@${ip}:$GuestPath" `
    $HostPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to copy $GuestPath from guest."
  }
}

function Ensure-GuestFirefox {
  $script = @'
set -euo pipefail
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb x11vnc fluxbox scrot xdotool git curl jq nodejs npm novnc websockify libgtk-3-0 libdbus-glib-1-2 libasound2t64 libxt6 libx11-xcb1 libxcb-shm0 libxcb-render0 libxrandr2 libxi6 >/tmp/cbe-vm-apt.log 2>&1

mkdir -p /home/ubuntu/.local/opt
if [ ! -x /home/ubuntu/.local/opt/firefox/firefox ]; then
  curl -L 'https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US' -o /tmp/firefox.tar.xz
  rm -rf /home/ubuntu/.local/opt/firefox
  tar -xJf /tmp/firefox.tar.xz -C /home/ubuntu/.local/opt
fi
'@

  Invoke-GuestScript -Script $script
}

function Start-GuestBrowser {
  $script = @'
set -euo pipefail
pkill -9 -f 'Xvfb __DISPLAY__' || true
pkill -9 -f 'x11vnc.*__VNC_PORT__' || true
pkill -9 -f 'novnc_proxy.*__NOVNC_PORT__' || true
pkill -9 -f '/home/ubuntu/.local/opt/firefox/firefox' || true
rm -f /tmp/cbe-vm-*.log /tmp/cbe-vm-firefox.png
profile_dir=/home/ubuntu/.cbe-firefox-profile
rm -rf "$profile_dir"
mkdir -p "$profile_dir"
nohup Xvfb __DISPLAY__ -screen 0 1600x1000x24 >/tmp/cbe-vm-xvfb.log 2>&1 &
sleep 2
DISPLAY=__DISPLAY__ nohup fluxbox >/tmp/cbe-vm-fluxbox.log 2>&1 &
sleep 1
DISPLAY=__DISPLAY__ nohup x11vnc -forever -shared -rfbport __VNC_PORT__ -nopw >/tmp/cbe-vm-x11vnc.log 2>&1 &
sleep 1
nohup /usr/share/novnc/utils/novnc_proxy --listen __NOVNC_PORT__ --vnc localhost:__VNC_PORT__ >/tmp/cbe-vm-novnc.log 2>&1 &
sleep 2
DISPLAY=__DISPLAY__ nohup /home/ubuntu/.local/opt/firefox/firefox --new-instance --no-remote --profile "$profile_dir" 'https://chatgpt.com/' >/tmp/cbe-vm-firefox.log 2>&1 &
sleep 20
DISPLAY=__DISPLAY__ scrot /tmp/cbe-vm-firefox.png
'@
  $script = $script.Replace("__DISPLAY__", $guestDisplay).Replace("__VNC_PORT__", [string]$guestVncPort).Replace("__NOVNC_PORT__", [string]$guestNoVncPort)

  Invoke-GuestScript -Script $script
}

function Show-Status {
  $list = Get-InstanceListText
  $info = Get-InstanceInfoText
  $ip = Get-InstanceIp

  Write-Host $list.Trim()
  Write-Host ""
  Write-Host $info.Trim()
  Write-Host ""
  if ($ip) {
    Write-Host "SSH     : ssh -i `"$sshKeyPath`" ubuntu@$ip"
    Write-Host "noVNC   : http://${ip}:$guestNoVncPort/vnc.html?autoconnect=true&resize=scale"
    Write-Host "Repo VM : $guestRepoPath"
  }
}

switch ($Action) {
  "start" {
    Ensure-Instance
    Wait-ForSsh | Out-Null
    Ensure-RepoMount
    Ensure-GuestFirefox
    Start-GuestBrowser
    Show-Status
    Write-Host ""
    Write-Host "Screenshot: npm run firefox:vm:screenshot"
    Write-Host "Logs      : npm run firefox:vm:logs"
    return
  }
  "status" {
    if (-not (Test-InstanceExists)) {
      Write-Host "Multipass instance not created yet."
      return
    }
    Show-Status
    return
  }
  "logs" {
    if (-not (Test-InstanceExists)) {
      throw "Multipass instance not created yet."
    }
    $script = @'
set -euo pipefail
for file in /tmp/cbe-vm-firefox.log /tmp/cbe-vm-novnc.log /tmp/cbe-vm-x11vnc.log /tmp/cbe-vm-xvfb.log; do
  if [ -f "$file" ]; then
    echo "===== $file ====="
    tail -n 120 "$file"
  fi
done
'@
    Invoke-GuestScript -Script $script
    return
  }
  "screenshot" {
    if (-not (Test-InstanceExists)) {
      throw "Multipass instance not created yet."
    }
    Invoke-GuestScript -Script @"
set -euo pipefail
DISPLAY=$guestDisplay scrot /tmp/cbe-vm-firefox.png
"@
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    Copy-FromGuest -GuestPath "/tmp/cbe-vm-firefox.png" -HostPath $screenshotPath
    Write-Host $screenshotPath
    return
  }
  "stop" {
    if (-not (Test-InstanceExists)) {
      Write-Host "Multipass instance not created yet."
      return
    }
    Invoke-Multipass -Args @("stop", $instanceName) | Out-Null
    Write-Host "Firefox VM stopped."
    return
  }
}
