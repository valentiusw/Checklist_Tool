@echo off
REM ============================================================
REM  Smart Checklist - one-click launcher
REM  Starts a local web server for this folder and opens the
REM  tool in your default browser. Double-click this file.
REM ============================================================

setlocal
cd /d "%~dp0"
set "PORT=8000"

echo Starting Smart Checklist...
echo Serving at http://localhost:%PORT%/
echo.
echo A browser tab will open shortly.
echo To STOP the tool, close the "Smart Checklist server" window.

REM Start the web server in its own window (stays open until closed).
REM Uses serve.py (no-cache headers) so the browser never shows a stale version.
start "Smart Checklist server" /D "%~dp0" cmd /k python "%~dp0serve.py" %PORT%

REM Give the server a moment to come up, then open the browser.
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%/"

endlocal
