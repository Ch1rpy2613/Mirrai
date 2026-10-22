@echo off
title Mirrai
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
echo.
echo Mirrai has stopped. Press any key to close this window.
pause > nul
