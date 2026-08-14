@echo off
cd /d "%~dp0"
set "BASH="
if exist "D:\soft\Git\Git\bin\bash.exe" set "BASH=D:\soft\Git\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH (
  echo [ERROR] Git Bash not found. Install Git for Windows first.
  pause
  exit /b 1
)
rem Run dev.sh in its own console window (no cmd prompt on Ctrl+C)
start "XiaoSu Dev Server" "%BASH%" scripts/dev.sh
