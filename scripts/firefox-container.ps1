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

$composeFile = Join-Path $repoRoot "docker-compose.firefox.yml"
if (-not (Test-Path -LiteralPath $composeFile)) {
  throw "Missing compose file: $composeFile"
}

function Invoke-Compose {
  param([Parameter(Mandatory = $true)][string[]]$Args)

  & docker compose -f $composeFile @Args
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Args -join ' ') failed."
  }
}

switch ($Action) {
  "start" {
    Invoke-Compose -Args @("up", "-d", "--build", "firefox-dev")
    Write-Host "Firefox dev container is starting."
    Write-Host "noVNC UI : http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale"
    Write-Host "Logs     : npm run firefox:dev:logs"
    return
  }
  "stop" {
    Invoke-Compose -Args @("down", "--remove-orphans")
    Write-Host "Firefox dev container stopped."
    return
  }
  "status" {
    Invoke-Compose -Args @("ps")
    Write-Host ""
    Write-Host "noVNC UI : http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale"
    return
  }
  "logs" {
    Invoke-Compose -Args @("logs", "--tail=200", "firefox-dev")
    return
  }
  "screenshot" {
    $outputDir = Join-Path $repoRoot ".runtime\firefox-container"
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    $outputPath = Join-Path $outputDir "firefox-screen.png"
    & docker exec chatgptbetterexperience-fix-chatgpt-browser-debug-firefox-dev-1 sh -lc "DISPLAY=:99 import -window root /workspace/.runtime/firefox-container/firefox-screen.png >/dev/null 2>&1 || true"
    if (-not (Test-Path -LiteralPath $outputPath)) {
      throw "Failed to capture Firefox container screenshot."
    }
    Write-Host $outputPath
    return
  }
}
