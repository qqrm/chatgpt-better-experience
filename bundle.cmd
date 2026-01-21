@echo off
setlocal enabledelayedexpansion

rem Build a context bundle zip using git archive (tracked files only).
rem Excludes automatically: .git
rem Excludes by selection: icons (generated), node_modules, etc.

for /f "usebackq delims=" %%R in (`git rev-parse --show-toplevel 2^>nul`) do set "REPO_ROOT=%%R"
if "%REPO_ROOT%"=="" (
  echo ERROR: not a git repository
  exit /b 1
)

pushd "%REPO_ROOT%" >nul

for /f "usebackq delims=" %%H in (`git rev-parse --short HEAD 2^>nul`) do set "GIT_SHA=%%H"
if "%GIT_SHA%"=="" set "GIT_SHA=unknown"

for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmm"`) do set "TS=%%T"

rem Output name: gpt-better-YYYY-MM-DD-HHMM-<sha>.zip
set "OUT_NAME=gpt-better-%TS%-%GIT_SHA%.zip"

if exist "%OUT_NAME%" del /f /q "%OUT_NAME%" >nul 2>&1

git archive --format=zip --output "%OUT_NAME%" HEAD ^
  .github ^
  .husky ^
  icons-src ^
  scripts ^
  src ^
  tests ^
  .eslintignore ^
  .eslintrc.cjs ^
  .gitignore ^
  .prettierignore ^
  .prettierrc.json ^
  AGENTS.md ^
  amo-metadata.json ^
  content.ts ^
  LICENSE ^
  manifest.json ^
  package-lock.json ^
  package.json ^
  popup.html ^
  popup.ts ^
  README.md ^
  settings.ts ^
  tsconfig.json ^
  vitest.config.ts

if errorlevel 1 (
  echo ERROR: git archive failed
  popd >nul
  exit /b 1
)

echo OK: %OUT_NAME%

popd >nul
exit /b 0
