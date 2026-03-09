[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Task,

  [ValidateNotNullOrEmpty()]
  [string]$BaseBranch = "",

  [ValidateNotNullOrEmpty()]
  [string]$WorktreeRoot = ""
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

function Convert-ToTaskSlug {
  param([Parameter(Mandatory = $true)][string]$Value)

  $slug = $Value.ToLowerInvariant() -replace "[^a-z0-9]+", "-"
  $slug = $slug.Trim("-")
  if ([string]::IsNullOrWhiteSpace($slug)) {
    throw "Task name '$Value' cannot be converted to a valid slug."
  }

  return $slug
}

$repoRoot = (Invoke-Git -Args @("rev-parse", "--show-toplevel")).Trim()
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve repository root."
}

$gitMarker = Join-Path $repoRoot ".git"
if (-not (Test-Path -LiteralPath $gitMarker)) {
  throw "Missing .git marker at $repoRoot."
}

$isPrimaryCheckout = (Get-Item -Force -LiteralPath $gitMarker).PSIsContainer
if (-not $isPrimaryCheckout) {
  throw "Run task-start.ps1 from the primary checkout (not from a linked worktree)."
}

$currentBranch = (Invoke-Git -Args @("branch", "--show-current") -WorkDir $repoRoot).Trim()
if (-not $BaseBranch) {
  $BaseBranch = $currentBranch
}

if ($currentBranch -ne $BaseBranch) {
  throw "Current branch is '$currentBranch'. Checkout '$BaseBranch' in the primary checkout before running task-start.ps1."
}

$status = Invoke-Git -Args @("status", "--porcelain") -WorkDir $repoRoot
if (-not [string]::IsNullOrWhiteSpace($status)) {
  throw "Primary checkout has uncommitted changes. Commit/stash them before syncing and creating a task worktree."
}

$taskSlug = Convert-ToTaskSlug -Value $Task
$branchName = "codex/$taskSlug"
$repoName = Split-Path -Leaf $repoRoot

if (-not $WorktreeRoot) {
  $repoParent = Split-Path -Parent $repoRoot
  $WorktreeRoot = Join-Path $repoParent "wt"
}

$worktreePath = Join-Path $WorktreeRoot "$repoName-$taskSlug"

if (Test-Path -LiteralPath $worktreePath) {
  throw "Worktree path already exists: $worktreePath"
}

$existingLocalBranch = Invoke-Git -Args @("branch", "--list", $branchName) -WorkDir $repoRoot
if (-not [string]::IsNullOrWhiteSpace($existingLocalBranch)) {
  throw "Local branch already exists: $branchName"
}

$existingRemoteBranch = Invoke-Git -Args @("ls-remote", "--heads", "origin", $branchName) -WorkDir $repoRoot
if (-not [string]::IsNullOrWhiteSpace($existingRemoteBranch)) {
  throw "Remote branch already exists: $branchName"
}

if (-not (Test-Path -LiteralPath $WorktreeRoot)) {
  New-Item -ItemType Directory -Path $WorktreeRoot | Out-Null
}

Write-Host "Syncing base branch '$BaseBranch' from origin..."
Invoke-Git -Args @("fetch", "origin") -WorkDir $repoRoot | Out-Null
Invoke-Git -Args @("pull", "--ff-only", "origin", $BaseBranch) -WorkDir $repoRoot | Out-Null

Write-Host "Creating task worktree..."
Invoke-Git -Args @("worktree", "add", $worktreePath, "-b", $branchName, "origin/$BaseBranch") -WorkDir $repoRoot | Out-Null

Write-Host ""
Write-Host "Task worktree ready."
Write-Host "Branch : $branchName"
Write-Host "Path   : $worktreePath"
Write-Host ""
Write-Host "Next:"
Write-Host "  Set-Location '$worktreePath'"
Write-Host "  npm ci"
