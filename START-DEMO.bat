@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel% equ 0 (
  start "" "http://127.0.0.1:4173"
  py -3 -m http.server 4173 --bind 127.0.0.1
  goto :end
)
where python >nul 2>&1
if %errorlevel% equ 0 (
  start "" "http://127.0.0.1:4173"
  python -m http.server 4173 --bind 127.0.0.1
  goto :end
)
echo Python was not found. Opening the standalone web demo instead.
start "" "%~dp0index.html"
:end
pause
