@echo off
title Stream to Shorts - setup
cd /d "%~dp0"
echo Downloading the tools Stream to Shorts needs (ffmpeg, speech recognition, speech model).
echo This is done once and takes a few minutes (about 700 MB).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
