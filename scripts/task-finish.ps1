[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [string]$BaseBranch = "main",

  [string]$PrTitle = "",

  [string]$PrBody = "",

  [switch]$SkipVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args,

    [string]$WorkDir = ""
  )

  if ($WorkDir) {
    $output = & git -C $WorkDir @Args 2>&1
  } else {
    $output = & git @Args 2>&1
  }

  if ($LASTEXITCODE -ne 0) {
    $joined = $output -join [Environment]::NewLine
    throw "git $($Args -join ' ') failed.`n$joined"
  }

  return ($output -join [Environment]::NewLine).TrimEnd()
}

function Ensure-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is not available: $Name"
  }
}

$repoRoot = (Invoke-Git -Args @("rev-parse", "--show-toplevel")).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve repository root."
}

$gitMarker = Join-Path $repoRoot ".git"
if (-not (Test-Path -LiteralPath $gitMarker)) {
  throw "Missing .git marker at $repoRoot."
}

$isPrimaryCheckout = (Get-Item -LiteralPath $gitMarker).PSIsContainer
if ($isPrimaryCheckout) {
  throw "Run task-finish.ps1 from a linked task worktree, not from the primary checkout."
}

$branchName = (Invoke-Git -Args @("branch", "--show-current") -WorkDir $repoRoot).Trim()
if (-not $branchName.StartsWith("codex/")) {
  throw "Current branch '$branchName' is not a task branch (expected prefix: codex/)."
}

$status = Invoke-Git -Args @("status", "--porcelain") -WorkDir $repoRoot
if (-not [string]::IsNullOrWhiteSpace($status)) {
  throw "Working tree is not clean. Commit/stash all changes before running task-finish.ps1."
}

Write-Host "Fetching origin..."
Invoke-Git -Args @("fetch", "origin") -WorkDir $repoRoot | Out-Null
Invoke-Git -Args @("rev-parse", "--verify", "origin/$BaseBranch") -WorkDir $repoRoot | Out-Null

$upstreamBranch = ""
$upstreamRaw = & git -C $repoRoot rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if ($LASTEXITCODE -eq 0) {
  $upstreamBranch = ($upstreamRaw -join [Environment]::NewLine).Trim()
}

if (-not [string]::IsNullOrWhiteSpace($upstreamBranch)) {
  $countsRaw = Invoke-Git -Args @("rev-list", "--left-right", "--count", "HEAD...$upstreamBranch") -WorkDir $repoRoot
  $counts = $countsRaw.Trim() -split "\s+"
  if ($counts.Count -ge 2) {
    $remoteAhead = [int]$counts[1]
    if ($remoteAhead -gt 0) {
      Write-Host "Upstream branch moved ($upstreamBranch). Rebasing onto upstream first..."
      Invoke-Git -Args @("rebase", $upstreamBranch) -WorkDir $repoRoot | Out-Null
    }
  }
}

Write-Host "Rebasing onto origin/$BaseBranch..."
Invoke-Git -Args @("rebase", "origin/$BaseBranch") -WorkDir $repoRoot | Out-Null

if (-not $SkipVerify) {
  Write-Host "Running npm run verify:ci..."
  & npm run verify:ci
  if ($LASTEXITCODE -ne 0) {
    throw "npm run verify:ci failed."
  }
}

if (-not [string]::IsNullOrWhiteSpace($upstreamBranch)) {
  Write-Host "Pushing with --force-with-lease to preserve rebased history..."
  Invoke-Git -Args @("push", "--force-with-lease", "origin", $branchName) -WorkDir $repoRoot | Out-Null
} else {
  Write-Host "Pushing branch and setting upstream..."
  Invoke-Git -Args @("push", "-u", "origin", $branchName) -WorkDir $repoRoot | Out-Null
}

Ensure-Command -Name "gh"

$existingJson = & gh pr list --head $branchName --base $BaseBranch --state open --json number,url --limit 1
if ($LASTEXITCODE -ne 0) {
  throw "Unable to query pull requests with gh."
}

$existingPrs = @()
if (-not [string]::IsNullOrWhiteSpace($existingJson)) {
  $parsed = $existingJson | ConvertFrom-Json
  if ($null -ne $parsed) {
    if ($parsed -is [System.Array]) {
      $existingPrs = $parsed
    } else {
      $existingPrs = @($parsed)
    }
  }
}

if ($existingPrs.Count -gt 0) {
  Write-Host "Open PR already exists: $($existingPrs[0].url)"
  return
}

if ([string]::IsNullOrWhiteSpace($PrTitle)) {
  $PrTitle = (Invoke-Git -Args @("log", "-1", "--pretty=%s") -WorkDir $repoRoot).Trim()
}

if ([string]::IsNullOrWhiteSpace($PrBody)) {
  if ($SkipVerify) {
    $PrBody = "## Summary`n- Automated PR created by task-finish.ps1.`n`n## Validation (local)`n- skipped (`-SkipVerify`)"
  } else {
    $PrBody = "## Summary`n- Automated PR created by task-finish.ps1.`n`n## Validation (local)`n- npm run verify:ci"
  }
}

Write-Host "Creating pull request..."
$prUrl = & gh pr create --base $BaseBranch --head $branchName --title $PrTitle --body $PrBody
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create pull request with gh."
}

Write-Host "Pull request opened: $prUrl"
