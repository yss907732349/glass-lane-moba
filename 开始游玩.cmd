@echo off
setlocal
cd /d "%~dp0"
if exist "release\GlassLane-0.2.0-Portable.exe" (
  start "" "release\GlassLane-0.2.0-Portable.exe"
  exit /b 0
)
echo Please open GlassLane-0.2.0-Setup.exe or GlassLane-0.2.0-Portable.exe in the release folder.
pause
