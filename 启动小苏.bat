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
rem 在新窗口直接运行 bash（不再经过 cmd 等待，Ctrl+C 不会出现"终止批处理操作"提示）
start "XiaoSu Dev Server" "%BASH%" scripts/dev.sh
