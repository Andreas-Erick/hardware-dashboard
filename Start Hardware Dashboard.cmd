@echo off
rem Opens Hardware Dashboard. On first run it installs what's needed and adds Desktop and Start Menu shortcuts.
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo First start: installing components, this takes a minute...
  call npm install
  node node_modules\electron\install.js
)
if not exist "%USERPROFILE%\Desktop\Hardware Dashboard.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1 >nul
)
start "" node_modules\electron\dist\electron.exe .
