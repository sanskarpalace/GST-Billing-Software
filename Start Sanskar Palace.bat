@echo off
setlocal enabledelayedexpansion
REM Sanskar Palace Billing - desktop launcher (data in Neon cloud)
cd /d "%~dp0"
title Sanskar Palace Billing

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Install it from https://nodejs.org  ^(choose the LTS version^), then run this again.
  echo.
  pause
  exit /b 1
)

REM First-time: ask for the Neon database link and save it to .env
if not exist ".env" goto makeenv
goto haveenv

:makeenv
echo.
echo  ===== First-time setup =====
echo  Paste your Neon database link ^(DATABASE_URL^) below and press Enter.
echo  It looks like:  postgresql://...neon.tech/neondb?sslmode=require^&channel_binding=require
echo.
set "DBURL="
set /p "DBURL=DATABASE_URL: "
if "!DBURL!"=="" (
  echo  Nothing entered. Run the launcher again and paste the link.
  pause
  exit /b 1
)
> ".env" echo DATABASE_URL=!DBURL!
>> ".env" echo APP_VERSION=1.0.0
echo  Saved .env.  (You won't be asked again on this PC.)
echo.

:haveenv
if not exist "node_modules" (
  echo  Installing ^(one time, a few minutes, needs internet^)...
  call npm install || (echo  npm install failed & pause & exit /b 1)
)
if not exist "dist" (
  echo  Building the app ^(one time^)...
  call npm run build || (echo  build failed & pause & exit /b 1)
)

echo  Starting Sanskar Palace Billing...
start "" http://localhost:47371
node desktop.mjs
pause
