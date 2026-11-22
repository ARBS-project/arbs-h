@echo off
rem ARBS-H read-only snapshot (no administrator needed): service states, firewall rule and task names,
rem Vibepollo file list (name, size, time; credentials skipped) -> ARBS-H-snapshot-<time>.txt on the desktop.
set "APPDIR=%~dp0..\.."
if not exist "%APPDIR%\sunshine.exe" set "APPDIR=%ProgramFiles%\ARBS-H"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0arbs-h-setup.ps1" -Action snapshot -AppDir "%APPDIR%"
echo.
echo Snapshot saved on the desktop as ARBS-H-snapshot-....txt (code %errorlevel%).
pause
