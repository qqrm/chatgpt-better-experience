[CmdletBinding()]
param(
  [ValidateSet("start", "stop", "status", "logs", "screenshot", "reset-profile")]
  [string]$Action = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve repository root. Run this script inside the repository."
}
$repoRoot = $repoRoot.Trim()

$gitCommonDir = (& git rev-parse --path-format=absolute --git-common-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitCommonDir)) {
  $gitCommonDir = Join-Path $repoRoot ".git"
}
$gitCommonDir = $gitCommonDir.Trim()
$commonRepoRoot = Split-Path -Parent $gitCommonDir
if ([string]::IsNullOrWhiteSpace($commonRepoRoot)) {
  $commonRepoRoot = $repoRoot
}
$commonRepoRoot = $commonRepoRoot.Trim()

$runtimeRoot = Join-Path $repoRoot ".runtime\multipass"
$imageDir = Join-Path $runtimeRoot "images"
$cloudInitPath = Join-Path $runtimeRoot "cloud-init.yaml"
$imagePath = Join-Path $imageDir "ubuntu-24.04-server-cloudimg-amd64.img"
$screenshotPath = Join-Path $runtimeRoot "firefox-screen.png"
$proxyTunnelPidPath = Join-Path $runtimeRoot "host-proxy-tunnel.pid"
$proxyTunnelInfoPath = Join-Path $runtimeRoot "host-proxy-tunnel.json"

$instanceName = "cbe-debug-generic"
$guestRepoPath = "/home/ubuntu/cbe"
$guestDisplay = ":101"
$guestVncPort = 5902
$guestNoVncPort = 6082
$guestProxyListenHost = "127.0.0.1"
$guestProxyListenPort = 17897
$defaultVmCpuCount = 2
$defaultVmMemory = "3G"
$imageUrl = "https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img"
$legacySshDirs = @(
  (Join-Path $repoRoot ".runtime\hyperv\ssh"),
  (Join-Path $commonRepoRoot ".runtime\hyperv\ssh"),
  (Join-Path $repoRoot ".runtime\multipass\ssh"),
  (Join-Path $commonRepoRoot ".runtime\multipass\ssh")
)
$sharedSshDir = Join-Path $commonRepoRoot ".runtime\multipass-shared\ssh"
$sshDir = $sharedSshDir
foreach ($candidate in $legacySshDirs) {
  if (Test-Path -LiteralPath (Join-Path $candidate "id_ed25519")) {
    $sshDir = $candidate
    break
  }
}
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

function Resolve-PositiveIntSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$DefaultValue
  )

  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $DefaultValue
  }

  $value = 0
  if (-not [int]::TryParse($raw, [ref]$value) -or $value -lt 1) {
    throw "$Name must be a positive integer. Current value: $raw"
  }

  return $value
}

function Resolve-MemorySetting {
  $raw = [Environment]::GetEnvironmentVariable("CBE_FIREFOX_VM_MEMORY")
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $defaultVmMemory
  }

  if ($raw -notmatch '^\d+(?:[KMGTP](?:i?B)?|B)$') {
    throw "CBE_FIREFOX_VM_MEMORY must look like 3G, 3072M, or 3GiB. Current value: $raw"
  }

  return $raw.ToUpperInvariant()
}

$vmCpuCount = Resolve-PositiveIntSetting -Name "CBE_FIREFOX_VM_CPUS" -DefaultValue $defaultVmCpuCount
$vmMemory = Resolve-MemorySetting

function Resolve-ProxyConfigFromUri {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Source
  )

  try {
    $uri = [System.Uri]$Value
  }
  catch {
    throw "Invalid proxy URI from ${Source}: $Value"
  }

  if (-not $uri.IsAbsoluteUri) {
    throw "Proxy URI from ${Source} must be absolute: $Value"
  }
  if ($uri.Port -lt 1) {
    throw "Proxy URI from ${Source} must include an explicit port: $Value"
  }

  $scheme = $uri.Scheme.ToLowerInvariant()
  if ($scheme -notin @("http", "https", "socks5", "socks")) {
    throw "Unsupported proxy scheme from ${Source}: $($uri.Scheme)"
  }

  return [pscustomobject]@{
    Source = $Source
    Scheme = $scheme
    Host = $uri.Host
    Port = $uri.Port
  }
}

function Resolve-HostProxyConfig {
  if (-not [string]::IsNullOrWhiteSpace($env:CBE_FIREFOX_VM_PROXY)) {
    return Resolve-ProxyConfigFromUri -Value $env:CBE_FIREFOX_VM_PROXY -Source "CBE_FIREFOX_VM_PROXY"
  }

  foreach ($name in @("HTTPS_PROXY", "ALL_PROXY", "HTTP_PROXY")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return Resolve-ProxyConfigFromUri -Value $value -Source $name
    }
  }

  $clashConfigPath = Join-Path $env:APPDATA "io.github.clash-verge-rev.clash-verge-rev\config.yaml"
  if (Test-Path -LiteralPath $clashConfigPath) {
    $raw = Get-Content -LiteralPath $clashConfigPath -Raw
    if ($raw -match "(?m)^\s*mixed-port:\s*(\d+)\s*$") {
      return [pscustomobject]@{
        Source = "Clash Verge config"
        Scheme = "http"
        Host = "127.0.0.1"
        Port = [int]$Matches[1]
      }
    }
    if ($raw -match "(?m)^\s*port:\s*(\d+)\s*$") {
      return [pscustomobject]@{
        Source = "Clash Verge config"
        Scheme = "http"
        Host = "127.0.0.1"
        Port = [int]$Matches[1]
      }
    }
  }

  return $null
}

function Get-ActiveProxyTunnelInfo {
  if (-not (Test-Path -LiteralPath $proxyTunnelPidPath) -or -not (Test-Path -LiteralPath $proxyTunnelInfoPath)) {
    return $null
  }

  $pidText = (Get-Content -LiteralPath $proxyTunnelPidPath -Raw).Trim()
  $processIdValue = 0
  if (-not [int]::TryParse($pidText, [ref]$processIdValue)) {
    Remove-Item -LiteralPath $proxyTunnelPidPath, $proxyTunnelInfoPath -Force -ErrorAction SilentlyContinue
    return $null
  }

  $process = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $proxyTunnelPidPath, $proxyTunnelInfoPath -Force -ErrorAction SilentlyContinue
    return $null
  }

  try {
    return Get-Content -LiteralPath $proxyTunnelInfoPath -Raw | ConvertFrom-Json
  }
  catch {
    return $null
  }
}

function Stop-GuestProxyTunnel {
  $pidText = if (Test-Path -LiteralPath $proxyTunnelPidPath) {
    (Get-Content -LiteralPath $proxyTunnelPidPath -Raw).Trim()
  } else {
    ""
  }

  $processIdValue = 0
  if ([int]::TryParse($pidText, [ref]$processIdValue)) {
    Stop-Process -Id $processIdValue -Force -ErrorAction SilentlyContinue
  }

  $staleSshProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match "^ssh(?:\.exe)?$" -and
      $_.CommandLine -match "(?:^|\s)-R\s+$($guestProxyListenPort):" -and
      $_.CommandLine -match [regex]::Escape("ubuntu@")
    }
  foreach ($staleProcess in $staleSshProcesses) {
    Stop-Process -Id $staleProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $proxyTunnelPidPath, $proxyTunnelInfoPath -Force -ErrorAction SilentlyContinue
}

function Ensure-GuestProxyTunnel {
  param([Parameter(Mandatory = $true)][string]$Ip)

  $proxyConfig = Resolve-HostProxyConfig
  if (-not $proxyConfig) {
    Stop-GuestProxyTunnel
    return $null
  }

  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  Stop-GuestProxyTunnel

  $remoteSpec = "${guestProxyListenPort}:$($proxyConfig.Host):$($proxyConfig.Port)"
  $args = @(
    "-f",
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-i", $sshKeyPath,
    "-R", $remoteSpec,
    "ubuntu@$Ip"
  )

  $cmdArgs = $args | ForEach-Object {
    '"' + ($_ -replace '"', '\"') + '"'
  }
  $cmdLine = 'start "" /b "{0}" {1}' -f $sshPath, ($cmdArgs -join ' ')
  & cmd.exe /c $cmdLine | Out-Null
  Start-Sleep -Seconds 3

  $process = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match "^ssh(?:\.exe)?$" -and
      $_.CommandLine -match [regex]::Escape($remoteSpec) -and
      $_.CommandLine -match [regex]::Escape("ubuntu@$Ip")
    } |
    Select-Object -First 1
  if (-not $process) {
    throw "Failed to resolve the background ssh process for VM proxy tunnel $remoteSpec."
  }

  $script = @"
set -euo pipefail
ss -ltn | grep -F '$($guestProxyListenHost):$guestProxyListenPort' >/dev/null
"@
  Invoke-GuestScript -Script $script

  $info = [pscustomobject]@{
    Source = $proxyConfig.Source
    Scheme = $proxyConfig.Scheme
    Host = $proxyConfig.Host
    Port = $proxyConfig.Port
    GuestHost = $guestProxyListenHost
    GuestPort = $guestProxyListenPort
    ProcessId = $process.ProcessId
  }

  Set-Content -LiteralPath $proxyTunnelPidPath -Value $process.ProcessId -NoNewline
  Set-Content -LiteralPath $proxyTunnelInfoPath -Value ($info | ConvertTo-Json -Compress) -NoNewline

  return $info
}

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

function Ensure-GuestAuthorizedKey {
  Ensure-SshKey
  $pubKey = (Get-Content -LiteralPath $sshPubPath -Raw).Trim()
  $script = @"
set -euo pipefail
mkdir -p /home/ubuntu/.ssh
touch /home/ubuntu/.ssh/authorized_keys
if ! grep -qxF '$pubKey' /home/ubuntu/.ssh/authorized_keys; then
  printf '%s\n' '$pubKey' >> /home/ubuntu/.ssh/authorized_keys
fi
chmod 700 /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys
"@

  Invoke-Multipass -Args @("exec", $instanceName, "--", "bash", "-lc", $script) | Out-Null
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

function Apply-InstanceResourceConfig {
  Invoke-Multipass -Args @("set", "local.${instanceName}.cpus=$vmCpuCount") | Out-Null
  Invoke-Multipass -Args @("set", "local.${instanceName}.memory=$vmMemory") | Out-Null
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
      "--cpus", "$vmCpuCount",
      "--memory", $vmMemory,
      "--disk", "20G",
      "--cloud-init", $cloudInitPath,
      "--timeout", "600"
    ) | Out-Null
  }
  elseif ((Get-InstanceState) -ne "Running") {
    Apply-InstanceResourceConfig
    Invoke-Multipass -Args @("start", $instanceName) | Out-Null
  }
}

function Wait-ForSsh {
  Ensure-GuestAuthorizedKey
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

  $mountPattern = "(?m)^\s*(.+?)\s+=>\s+$([regex]::Escape($guestRepoPath))\s*$"
  if ($info -match $mountPattern) {
    Invoke-Multipass -Args @("umount", "${instanceName}:$guestRepoPath") | Out-Null
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
  param($ProxyConfig)

  $proxyEnvBlock = ""
  if ($ProxyConfig -and $ProxyConfig.Scheme -in @("http", "https")) {
    $proxyUri = "$($ProxyConfig.Scheme)://$($ProxyConfig.GuestHost):$($ProxyConfig.GuestPort)"
    $proxyEnvBlock = @"
export http_proxy='$proxyUri'
export https_proxy='$proxyUri'
export HTTP_PROXY='$proxyUri'
export HTTPS_PROXY='$proxyUri'
"@
  }

  $script = @'
set -euo pipefail
__PROXY_ENV__
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb x11vnc fluxbox scrot xdotool git curl jq nodejs npm novnc websockify libgtk-3-0 libdbus-glib-1-2 libasound2t64 libxt6 libx11-xcb1 libxcb-shm0 libxcb-render0 libxrandr2 libxi6 >/tmp/cbe-vm-apt.log 2>&1

mkdir -p /home/ubuntu/.local/opt
if [ ! -x /home/ubuntu/.local/opt/firefox/firefox ]; then
  curl -L 'https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US' -o /tmp/firefox.tar.xz
  rm -rf /home/ubuntu/.local/opt/firefox
  tar -xJf /tmp/firefox.tar.xz -C /home/ubuntu/.local/opt
fi
'@
  $script = $script.Replace("__PROXY_ENV__", $proxyEnvBlock)

  Invoke-GuestScript -Script $script
}

function Start-GuestBrowser {
  param($ProxyConfig)

  $proxySetup = "rm -f `"`$profile_dir/user.js`""
  if ($ProxyConfig) {
    $userPrefs = switch ($ProxyConfig.Scheme) {
      { $_ -in @("http", "https") } {
        @(
          'user_pref("network.proxy.type", 1);',
          'user_pref("network.proxy.share_proxy_settings", true);',
          "user_pref(`"network.proxy.http`", `"$($ProxyConfig.GuestHost)`");",
          "user_pref(`"network.proxy.http_port`", $($ProxyConfig.GuestPort));",
          "user_pref(`"network.proxy.ssl`", `"$($ProxyConfig.GuestHost)`");",
          "user_pref(`"network.proxy.ssl_port`", $($ProxyConfig.GuestPort));",
          'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");'
        ) -join "`n"
        break
      }
      { $_ -in @("socks", "socks5") } {
        @(
          'user_pref("network.proxy.type", 1);',
          "user_pref(`"network.proxy.socks`", `"$($ProxyConfig.GuestHost)`");",
          "user_pref(`"network.proxy.socks_port`", $($ProxyConfig.GuestPort));",
          'user_pref("network.proxy.socks_version", 5);',
          'user_pref("network.proxy.socks_remote_dns", true);',
          'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");'
        ) -join "`n"
        break
      }
      default {
        throw "Unsupported guest proxy scheme: $($ProxyConfig.Scheme)"
      }
    }

    $proxySetup = @"
cat > "`$profile_dir/user.js" <<'EOF'
$userPrefs
EOF
"@
  }

  $script = @'
set -euo pipefail
pkill -9 -f 'Xvfb __DISPLAY__' || true
pkill -9 -f 'x11vnc.*__VNC_PORT__' || true
pkill -9 -f 'novnc_proxy.*__NOVNC_PORT__' || true
pkill -9 -f '/home/ubuntu/.local/opt/firefox/firefox' || true
rm -f /tmp/cbe-vm-*.log /tmp/cbe-vm-firefox.png
profile_dir=/home/ubuntu/.cbe-firefox-profile
mkdir -p "$profile_dir"
__PROXY_SETUP__
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
  $script = $script.Replace("__DISPLAY__", $guestDisplay).Replace("__VNC_PORT__", [string]$guestVncPort).Replace("__NOVNC_PORT__", [string]$guestNoVncPort).Replace("__PROXY_SETUP__", $proxySetup)

  Invoke-GuestScript -Script $script
}

function Reset-GuestBrowserProfile {
  $script = @'
set -euo pipefail
pkill -9 -f '/home/ubuntu/.local/opt/firefox/firefox' || true
rm -rf /home/ubuntu/.cbe-firefox-profile
'@

  Invoke-GuestScript -Script $script
}

function Show-Status {
  $list = Get-InstanceListText
  $info = Get-InstanceInfoText
  $ip = Get-InstanceIp
  $proxyInfo = Get-ActiveProxyTunnelInfo
  $configuredCpuCount = (Invoke-Multipass -Args @("get", "local.${instanceName}.cpus") -AllowFailure:$false | Out-String).Trim()
  $configuredMemory = (Invoke-Multipass -Args @("get", "local.${instanceName}.memory") -AllowFailure:$false | Out-String).Trim()

  Write-Host $list.Trim()
  Write-Host ""
  Write-Host $info.Trim()
  Write-Host ""
  Write-Host "Configured: CPUs=$configuredCpuCount Memory=$configuredMemory"
  if ($ip) {
    Write-Host "SSH     : ssh -i `"$sshKeyPath`" ubuntu@$ip"
    Write-Host "noVNC   : http://${ip}:$guestNoVncPort/vnc.html?autoconnect=true&resize=scale"
    Write-Host "Repo VM : $guestRepoPath"
    if ($proxyInfo) {
      Write-Host "Proxy   : ${guestProxyListenHost}:$($proxyInfo.GuestPort) -> $($proxyInfo.Host):$($proxyInfo.Port) ($($proxyInfo.Source))"
    }
  }
}

switch ($Action) {
  "start" {
    Ensure-Instance
    $ip = Wait-ForSsh
    Ensure-RepoMount
    $proxyInfo = Ensure-GuestProxyTunnel -Ip $ip
    Ensure-GuestFirefox -ProxyConfig $proxyInfo
    Start-GuestBrowser -ProxyConfig $proxyInfo
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
    Stop-GuestProxyTunnel
    if (-not (Test-InstanceExists)) {
      Write-Host "Multipass instance not created yet."
      return
    }
    Invoke-Multipass -Args @("stop", $instanceName) | Out-Null
    Write-Host "Firefox VM stopped."
    return
  }
  "reset-profile" {
    if (-not (Test-InstanceExists)) {
      throw "Multipass instance not created yet."
    }
    if ((Get-InstanceState) -ne "Running") {
      Invoke-Multipass -Args @("start", $instanceName) | Out-Null
    }
    Wait-ForSsh | Out-Null
    Reset-GuestBrowserProfile
    Write-Host "Firefox VM profile reset."
    return
  }
}
