@echo off
REM Sanskar Palace Billing - desktop launcher (data in Neon cloud)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org (LTS^) and run this again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo  First-time setup: create a file named ".env" next to this launcher with:
  echo      DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies (one time^)...
  call npm install || (echo npm install failed & pause & exit /b 1)
)

if not exist "dist" (
  echo Building the app (one time^)...
  call npm run build || (echo build failed & pause & exit /b 1)
)

echo Starting Sanskar Palace Billing...
start "" http://localhost:47371
node desktop.mjs
pause
