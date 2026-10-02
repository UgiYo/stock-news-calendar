@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 local_ai_bridge.py --open
) else (
  python local_ai_bridge.py --open
)
pause
