@echo off
setlocal
cd /d "%~dp0"
title Developer Dashboard v1.2

where node >nul 2>&1 || (
  echo Node.js is required. Install Node.js LTS first.
  pause
  exit /b 1
)
where npm >nul 2>&1 || (
  echo npm was not found on PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dashboard dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building dashboard...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Starting Developer Dashboard v1.2 on http://localhost:4317
echo The UI now opens immediately; Git, GitHub and Vercel load independently.
echo Keep this window open. Press Ctrl+C to stop.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "$deadline=(Get-Date).AddSeconds(20); do { try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4317/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){Start-Process 'http://localhost:4317'; break} } catch {}; Start-Sleep -Milliseconds 400 } while((Get-Date) -lt $deadline)"
node server.mjs

set "RC=%ERRORLEVEL%"
echo.
echo Dashboard server stopped with exit code %RC%.
pause
exit /b %RC%
