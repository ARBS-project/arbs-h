@echo off
rem ARBS-H rollback: ARBS-H service to manual, Vibepollo service (ApolloService) back to its recorded values.
rem Asks for administrator rights (UAC) and keeps this window open at the end.
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0arbs-h-rollback.ps1" %*
set RC=%errorlevel%
echo.
if "%RC%"=="0" (echo ARBS-H rollback: done. Vibepollo service is back to its recorded start type.) else (echo ARBS-H rollback: failed, code %RC%. Logs: %ProgramData%\ARBS-H\setup-logs)
pause
