@echo off
rem Double-click to run Spider Crawler on Windows. It needs Node.js 22 or newer: https://nodejs.org
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Spider Crawler needs Node.js 22 or newer.
  echo Install it from https://nodejs.org, then open this file again.
  pause
  exit /b 1
)
node bin\spider-crawler.mjs %*
if errorlevel 1 pause
