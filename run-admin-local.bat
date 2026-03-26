@echo off
setlocal ENABLEEXTENSIONS
chcp 65001 >nul

set "ROOT=%~dp0"
set "API_DIR=%ROOT%server\admin-api"
set "SITE_ROOT=%ROOT%"

echo [INFO] Root: %ROOT%
echo [INFO] API:  %API_DIR%
echo [INFO] SITE_ROOT: %SITE_ROOT%

if not exist "%API_DIR%\index.js" (
  echo [ERROR] Missing "%API_DIR%\index.js"
  echo Check project structure: folder server\admin-api must exist
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [WARN] Node.js / npm not found.
  echo [INFO] Trying to install Node.js LTS via winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] winget not found. Install Node.js LTS manually:
    echo https://nodejs.org/
    pause
    exit /b 1
  )

  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [ERROR] Failed to install Node.js via winget.
    echo Install manually: https://nodejs.org/
    pause
    exit /b 1
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found even after Node.js install.
  echo Reopen terminal and run this bat again.
  pause
  exit /b 1
)

pushd "%API_DIR%"

if not exist "node_modules" (
  echo [INFO] node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    pause
    exit /b 1
  )
) else (
  echo [INFO] node_modules found, skipping npm install.
)

echo [INFO] Opening admin: http://localhost:3001/admin/
start "" "http://localhost:3001/admin/"

echo [INFO] Starting API...
set "ADMIN_LOCAL_FS=true"
set "SITE_ROOT=%SITE_ROOT%"
node index.js

popd
echo [INFO] Server stopped.
pause
exit /b 0
