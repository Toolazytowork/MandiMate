@echo off
rem MandiMate - Windows entry point. Runs dev.ps1 without needing to change the PowerShell execution policy.
rem Usage: dev.cmd [start^|share^|install^|stop^|restart^|status^|logs^|reset^|doctor^|help] [options]   (see dev.ps1)
where pwsh >NUL 2>NUL
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
)
exit /b %ERRORLEVEL%
