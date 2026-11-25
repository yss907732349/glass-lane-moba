@echo off
setlocal
cd /d "%~dp0"
if exist "release\GlassLane-0.1.1-Portable.exe" (
  start "" "release\GlassLane-0.1.1-Portable.exe"
  exit /b 0
)
echo Please open GlassLane-0.1.1-Setup.exe or GlassLane-0.1.1-Portable.exe in the release folder.
pause
