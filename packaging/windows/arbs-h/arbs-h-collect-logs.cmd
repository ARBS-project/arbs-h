@echo off
rem ARBS-H log collection (administrator): copies ARBS-H logs to the desktop as ARBS-H-logs-<time>.
rem No credentials, state or conf files are copied. Keeps this window open at the end.
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "APPDIR=%~dp0..\.."
if not exist "%APPDIR%\sunshine.exe" set "APPDIR=%ProgramFiles%\ARBS-H"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0arbs-h-setup.ps1" -Action collect-logs -AppDir "%APPDIR%"
echo.
echo ARBS-H logs were copied to a folder named ARBS-H-logs-... on the desktop (code %errorlevel%).
pause
