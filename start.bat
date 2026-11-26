@echo off
title Stream to Shorts - keep this window open while rendering
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "tools\ffmpeg\ffmpeg.exe" (
  where ffmpeg >nul 2>nul
  if errorlevel 1 (
    echo The tools are not installed yet. Double-click setup.bat first ^(once^), then start.bat again.
    pause
    exit /b 1
  )
)
echo Starting Stream to Shorts... your browser will open automatically.
echo.
echo   Keep this window open while you work. Closing it stops the app and any rendering.
echo   If you close it by mistake, run start.bat again: the app offers to resume your tasks.
echo.
node app\server.js
pause
