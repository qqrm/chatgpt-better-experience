[CmdletBinding()]
param(
  [ValidateSet("start", "rustdesk-start", "stop", "status", "rustdesk-status", "logs", "screenshot", "reset-profile")]
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
$noVncTunnelPidPath = Join-Path $runtimeRoot "host-novnc-tunnel.pid"
$debugTunnelPidPath = Join-Path $runtimeRoot "host-firefox-debug-tunnel.pid"
$rustDeskPasswordPath = Join-Path $runtimeRoot "rustdesk-password.txt"

$instanceName = "cbe-debug-generic"
$guestRepoPath = "/home/ubuntu/cbe"
$guestDisplay = ":101"
$guestVncPort = 5902
$guestNoVncPort = 6082
$guestFirefoxDebugPort = 6000
$rustDeskVersion = "1.4.6"
$rustDeskDebUrl = "https://github.com/rustdesk/rustdesk/releases/download/$rustDeskVersion/rustdesk-$rustDeskVersion-x86_64.deb"
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
$defaultSharedSshDir = Join-Path $commonRepoRoot ".runtime\multipass-shared\ssh"
$windowsSharedSshDir = Join-Path $env:LOCALAPPDATA "cbe\multipass-shared\ssh"
$sharedSshDir = if ($defaultSharedSshDir -like "\\*") {
  $windowsSharedSshDir
} else {
  $defaultSharedSshDir
}
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

function Resolve-ShortWindowsPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($Path -notmatch '^[A-Za-z]:\\') {
    return $Path
  }

  $escaped = $Path.Replace('"', '""')
  Push-Location "C:\"
  try {
    $short = & cmd.exe /d /c "for %I in (""$escaped"") do @echo %~sI" 2>$null
  }
  finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    return $Path
  }

  $value = ($short | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Path
  }

  return $value
}

$multipassPath = Resolve-CommandPath -Command "multipass" -Fallback "C:\Program Files\Multipass\bin\multipass.exe"
$sshPath = Resolve-CommandPath -Command "ssh"
$scpPath = Resolve-CommandPath -Command "scp"
$sshKeygenPath = Resolve-CommandPath -Command "ssh-keygen"
$sshKeyCliPath = Resolve-ShortWindowsPath -Path $sshKeyPath

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

function New-RandomSecret {
  param([int]$Length = 16)

  $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }
  $chars = for ($i = 0; $i -lt $Length; $i++) {
    $alphabet[$bytes[$i] % $alphabet.Length]
  }
  return -join $chars
}

function Get-RustDeskPassword {
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

  $explicitPassword = [Environment]::GetEnvironmentVariable("CBE_FIREFOX_VM_RUSTDESK_PASSWORD")
  if (-not [string]::IsNullOrWhiteSpace($explicitPassword)) {
    $password = $explicitPassword.Trim()
    Set-Content -LiteralPath $rustDeskPasswordPath -Value $password -NoNewline
    return $password
  }

  if (Test-Path -LiteralPath $rustDeskPasswordPath) {
    $password = (Get-Content -LiteralPath $rustDeskPasswordPath -Raw).Trim()
    if (-not [string]::IsNullOrWhiteSpace($password)) {
      return $password
    }
  }

  $generated = New-RandomSecret -Length 16
  Set-Content -LiteralPath $rustDeskPasswordPath -Value $generated -NoNewline
  return $generated
}

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

function Stop-GuestNoVncTunnel {
  $pidText = if (Test-Path -LiteralPath $noVncTunnelPidPath) {
    (Get-Content -LiteralPath $noVncTunnelPidPath -Raw).Trim()
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
      $_.CommandLine -match [regex]::Escape("${guestNoVncPort}:127.0.0.1:${guestNoVncPort}") -and
      $_.CommandLine -match [regex]::Escape("ubuntu@")
    }
  foreach ($staleProcess in $staleSshProcesses) {
    Stop-Process -Id $staleProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $noVncTunnelPidPath -Force -ErrorAction SilentlyContinue
}

function Stop-GuestFirefoxDebugTunnel {
  $pidText = if (Test-Path -LiteralPath $debugTunnelPidPath) {
    (Get-Content -LiteralPath $debugTunnelPidPath -Raw).Trim()
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
      $_.CommandLine -match [regex]::Escape("${guestFirefoxDebugPort}:127.0.0.1:${guestFirefoxDebugPort}") -and
      $_.CommandLine -match [regex]::Escape("ubuntu@")
    }
  foreach ($staleProcess in $staleSshProcesses) {
    Stop-Process -Id $staleProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $debugTunnelPidPath -Force -ErrorAction SilentlyContinue
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
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-i", $sshKeyCliPath,
    "-R", $remoteSpec,
    "ubuntu@$Ip"
  )
  $process = Start-Process -FilePath $sshPath -ArgumentList $args -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3
  if (-not $process) {
    throw "Failed to start the background ssh process for VM proxy tunnel $remoteSpec."
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
    ProcessId = $process.Id
  }

  Set-Content -LiteralPath $proxyTunnelPidPath -Value $process.Id -NoNewline
  Set-Content -LiteralPath $proxyTunnelInfoPath -Value ($info | ConvertTo-Json -Compress) -NoNewline

  return $info
}

function Ensure-GuestNoVncTunnel {
  param([Parameter(Mandatory = $true)][string]$Ip)

  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  Stop-GuestNoVncTunnel

  $forwardSpec = "${guestNoVncPort}:127.0.0.1:${guestNoVncPort}"
  $args = @(
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-i", $sshKeyCliPath,
    "-L", $forwardSpec,
    "ubuntu@$Ip"
  )

  $process = Start-Process -FilePath $sshPath -ArgumentList $args -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if (-not $process) {
    throw "Failed to start the background ssh process for VM noVNC tunnel $forwardSpec."
  }

  $probeOk = $false
  for ($i = 0; $i -lt 10; $i++) {
    if (Test-NetConnection -ComputerName "127.0.0.1" -Port $guestNoVncPort -InformationLevel Quiet -WarningAction SilentlyContinue) {
      $probeOk = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $probeOk) {
    throw "Failed to establish localhost noVNC tunnel on port $guestNoVncPort."
  }

  Set-Content -LiteralPath $noVncTunnelPidPath -Value $process.Id -NoNewline
}

function Ensure-GuestFirefoxDebugTunnel {
  param([Parameter(Mandatory = $true)][string]$Ip)

  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  Stop-GuestFirefoxDebugTunnel

  $forwardSpec = "${guestFirefoxDebugPort}:127.0.0.1:${guestFirefoxDebugPort}"
  $args = @(
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-i", $sshKeyCliPath,
    "-L", $forwardSpec,
    "ubuntu@$Ip"
  )

  $process = Start-Process -FilePath $sshPath -ArgumentList $args -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if (-not $process) {
    throw "Failed to start the background ssh process for Firefox debug tunnel $forwardSpec."
  }

  $probeOk = $false
  for ($i = 0; $i -lt 10; $i++) {
    if (Test-NetConnection -ComputerName "127.0.0.1" -Port $guestFirefoxDebugPort -InformationLevel Quiet -WarningAction SilentlyContinue) {
      $probeOk = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $probeOk) {
    throw "Failed to establish localhost Firefox debug tunnel on port $guestFirefoxDebugPort."
  }

  Set-Content -LiteralPath $debugTunnelPidPath -Value $process.Id -NoNewline
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
  $maxAttempts = 10
  do {
    $attempts++
    $output = @()
    $exitCode = 0
    try {
      $output = & $multipassPath @Args 2>&1
      $exitCode = $LASTEXITCODE
    }
    catch {
      $output = @($_.ToString())
      $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 1 }
    }

    if ($exitCode -eq 0) {
      return $output
    }

    $message = ($output | Out-String).Trim()
    $shouldRetry = $message -match "cannot connect to the multipass socket|grpc_wait_for_shutdown_with_timeout"
    if ($shouldRetry -and $attempts -lt $maxAttempts) {
      Start-Sleep -Seconds ([Math]::Min($attempts * 2, 10))
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

  $args = @("-q", "-t", "ed25519", "-N", "", "-f", $sshKeyCliPath)
  & $sshKeygenPath @args
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
  foreach ($setting in @("local.${instanceName}.cpus=$vmCpuCount", "local.${instanceName}.memory=$vmMemory")) {
    $output = Invoke-Multipass -Args @("set", $setting) -AllowFailure
    if ($LASTEXITCODE -eq 0) {
      continue
    }

    $message = ($output | Out-String).Trim()
    if ($message -match "Instance must be stopped for modification") {
      Write-Warning "Skipping live VM resource update for '$setting' because the instance is already running."
      continue
    }

    throw "Failed to apply Multipass setting '$setting'.`n$message"
  }
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
  else {
    $state = Get-InstanceState
    if ($state -eq "Running" -or $state -eq "Starting") {
      return
    }
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
        -i $sshKeyCliPath `
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
    $isWslUncMountFailure =
      ($repoRoot -match '^[\\/]{2}wsl\.localhost[\\/]') -and
      $message -match "weakly_canonical: The network name cannot be found"
    if ($isWslUncMountFailure) {
      Write-Warning "Skipping VM repo mount for WSL worktree path '$repoRoot'. Firefox/noVNC will still start, but the guest repo mount is unavailable from this path."
      return
    }
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
      -i $sshKeyCliPath `
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
      -i $sshKeyCliPath `
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
    -i $sshKeyCliPath `
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

function Ensure-GuestRustDesk {
  $script = @"
set -euo pipefail
target_version='$rustDeskVersion'
installed_version=`$(dpkg-query -W -f='`${Version}' rustdesk 2>/dev/null || true)
if [ "`$installed_version" != "`$target_version" ]; then
  curl -L '$rustDeskDebUrl' -o /tmp/rustdesk.deb
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/rustdesk.deb >/tmp/cbe-vm-rustdesk-install.log 2>&1
fi
"@

  Invoke-GuestScript -Script $script
}

function Start-GuestBrowser {
  param(
    $ProxyConfig,
    [bool]$EnableNoVnc = $true
  )

  $userPrefsLines = @(
    'user_pref("devtools.debugger.remote-enabled", true);',
    'user_pref("devtools.chrome.enabled", true);',
    'user_pref("devtools.debugger.prompt-connection", false);'
  )

  if ($ProxyConfig) {
    $proxyPrefs = switch ($ProxyConfig.Scheme) {
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
    $userPrefsLines += $proxyPrefs
  }

  $userPrefs = $userPrefsLines -join "`n"
  $proxySetup = @"
cat > "`$profile_dir/user.js" <<'EOF'
$userPrefs
EOF
"@

  $remoteDesktopSetup = @'
DISPLAY=__DISPLAY__ nohup x11vnc -forever -shared -rfbport __VNC_PORT__ -nopw >/tmp/cbe-vm-x11vnc.log 2>&1 &
sleep 1
if [ -x /usr/share/novnc/utils/novnc_proxy ]; then
  nohup /usr/share/novnc/utils/novnc_proxy --listen __NOVNC_PORT__ --vnc localhost:__VNC_PORT__ >/tmp/cbe-vm-novnc.log 2>&1 &
elif command -v websockify >/dev/null 2>&1 && [ -d /usr/share/novnc ]; then
  nohup websockify --web=/usr/share/novnc/ __NOVNC_PORT__ localhost:__VNC_PORT__ >/tmp/cbe-vm-novnc.log 2>&1 &
else
  echo "no noVNC launcher found" >/tmp/cbe-vm-novnc.log
  exit 1
fi
sleep 2
'@

  if (-not $EnableNoVnc) {
    $remoteDesktopSetup = "rm -f /tmp/cbe-vm-novnc.log /tmp/cbe-vm-x11vnc.log"
  }

  $script = @'
set -euo pipefail
pkill -9 -f 'Xvfb __DISPLAY__' || true
pkill -9 -f 'x11vnc.*__VNC_PORT__' || true
pkill -9 -f 'novnc_proxy.*__NOVNC_PORT__' || true
pkill -9 -f 'websockify.*__NOVNC_PORT__' || true
pkill -9 -f 'firefox.*--start-debugger-server __DEBUG_PORT__' || true
pkill -9 -f '/home/ubuntu/.local/opt/firefox/firefox' || true
rm -f /tmp/cbe-vm-*.log /tmp/cbe-vm-firefox.png
profile_dir=/home/ubuntu/.cbe-firefox-profile
mkdir -p "$profile_dir"
__PROXY_SETUP__
nohup Xvfb __DISPLAY__ -screen 0 1600x1000x24 >/tmp/cbe-vm-xvfb.log 2>&1 &
sleep 2
DISPLAY=__DISPLAY__ nohup fluxbox >/tmp/cbe-vm-fluxbox.log 2>&1 &
sleep 1
__REMOTE_DESKTOP_SETUP__
DISPLAY=__DISPLAY__ nohup /home/ubuntu/.local/opt/firefox/firefox --new-instance --no-remote --start-debugger-server __DEBUG_PORT__ --profile "$profile_dir" 'https://chatgpt.com/' >/tmp/cbe-vm-firefox.log 2>&1 &
sleep 20
DISPLAY=__DISPLAY__ scrot /tmp/cbe-vm-firefox.png
ss -ltn | grep -F ':__DEBUG_PORT__' >/dev/null
if [ "__ENABLE_NOVNC__" = "1" ]; then
  ss -ltn | grep -F ':__NOVNC_PORT__' >/dev/null
fi
'@
  $script = $script.Replace("__DISPLAY__", $guestDisplay).Replace("__VNC_PORT__", [string]$guestVncPort).Replace("__NOVNC_PORT__", [string]$guestNoVncPort).Replace("__DEBUG_PORT__", [string]$guestFirefoxDebugPort).Replace("__PROXY_SETUP__", $proxySetup).Replace("__REMOTE_DESKTOP_SETUP__", $remoteDesktopSetup).Replace("__ENABLE_NOVNC__", $(if ($EnableNoVnc) { "1" } else { "0" }))

  Invoke-GuestScript -Script $script
}

function Start-GuestRustDesk {
  param([Parameter(Mandatory = $true)][string]$Password)

  $script = @"
set -euo pipefail
if command -v rustdesk >/dev/null 2>&1; then
  rustdesk --password '$Password' >/tmp/cbe-vm-rustdesk-password.log 2>&1 || sudo rustdesk --password '$Password' >/tmp/cbe-vm-rustdesk-password.log 2>&1 || true
  sudo rustdesk --option allow-linux-headless Y >/tmp/cbe-vm-rustdesk-option.log 2>&1 || true
  pkill -9 -f '(^|/)rustdesk($| )' || true
  DISPLAY=$guestDisplay nohup rustdesk >/tmp/cbe-vm-rustdesk.log 2>&1 &
  sleep 8
fi
"@

  Invoke-GuestScript -Script $script
}

function Get-GuestRustDeskId {
  if (-not (Test-InstanceExists)) {
    return ""
  }
  if ((Get-InstanceState) -ne "Running") {
    return ""
  }

  try {
    $id = Invoke-Multipass -Args @("exec", $instanceName, "--", "bash", "-lc", "command -v rustdesk >/dev/null 2>&1 && rustdesk --get-id 2>/dev/null || true") -AllowFailure:$true | Out-String
    return $id.Trim()
  }
  catch {
    return ""
  }
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
  $rustDeskId = Get-GuestRustDeskId
  $configuredCpuCount = (Invoke-Multipass -Args @("get", "local.${instanceName}.cpus") -AllowFailure:$false | Out-String).Trim()
  $configuredMemory = (Invoke-Multipass -Args @("get", "local.${instanceName}.memory") -AllowFailure:$false | Out-String).Trim()

  Write-Host $list.Trim()
  Write-Host ""
  Write-Host $info.Trim()
  Write-Host ""
  Write-Host "Configured: CPUs=$configuredCpuCount Memory=$configuredMemory"
  if ($ip) {
    Write-Host "SSH     : ssh -i `"$sshKeyPath`" ubuntu@$ip"
    Write-Host "Debug   : localhost:$guestFirefoxDebugPort"
    Write-Host "Repo VM : $guestRepoPath"
    if (Test-Path -LiteralPath $noVncTunnelPidPath) {
      Write-Host "noVNC   : http://127.0.0.1:$guestNoVncPort/vnc.html?autoconnect=true&resize=scale"
      Write-Host "noVNC VM: http://${ip}:$guestNoVncPort/vnc.html?autoconnect=true&resize=scale"
    }
    if ($proxyInfo) {
      Write-Host "Proxy   : ${guestProxyListenHost}:$($proxyInfo.GuestPort) -> $($proxyInfo.Host):$($proxyInfo.Port) ($($proxyInfo.Source))"
    }
    if ($rustDeskId) {
      Write-Host "RustDesk: ID $rustDeskId"
      Write-Host "Password: $(Get-RustDeskPassword)"
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
    Start-GuestBrowser -ProxyConfig $proxyInfo -EnableNoVnc $true
    Ensure-GuestNoVncTunnel -Ip $ip
    Ensure-GuestFirefoxDebugTunnel -Ip $ip
    Show-Status
    Write-Host ""
    Write-Host "Screenshot: npm run firefox:vm:screenshot"
    Write-Host "Logs      : npm run firefox:vm:logs"
    return
  }
  "rustdesk-start" {
    Ensure-Instance
    $ip = Wait-ForSsh
    Ensure-RepoMount
    $proxyInfo = Ensure-GuestProxyTunnel -Ip $ip
    Stop-GuestNoVncTunnel
    Ensure-GuestFirefox -ProxyConfig $proxyInfo
    Ensure-GuestRustDesk
    Start-GuestBrowser -ProxyConfig $proxyInfo -EnableNoVnc $false
    Start-GuestRustDesk -Password (Get-RustDeskPassword)
    Ensure-GuestFirefoxDebugTunnel -Ip $ip
    Show-Status
    Write-Host ""
    Write-Host "RustDesk : connect from the host RustDesk client using the printed ID/password"
    Write-Host "Logs     : npm run firefox:vm:logs"
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
  "rustdesk-status" {
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
for file in /tmp/cbe-vm-firefox.log /tmp/cbe-vm-rustdesk.log /tmp/cbe-vm-rustdesk-install.log /tmp/cbe-vm-rustdesk-password.log /tmp/cbe-vm-novnc.log /tmp/cbe-vm-x11vnc.log /tmp/cbe-vm-xvfb.log; do
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
    Stop-GuestNoVncTunnel
    Stop-GuestFirefoxDebugTunnel
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
