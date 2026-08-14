@echo off
cd /d "%~dp0"
set "BASH="
if exist "D:\soft\Git\Git\bin\bash.exe" set "BASH=D:\soft\Git\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH (
  echo [ERROR] Git Bash not found. Please install Git for Windows first.
  pause
  exit /b 1
)
echo Starting XiaoSu (dev mode). Press Ctrl+C in the new window to stop.
"%BASH%" scripts/dev.sh
pause
