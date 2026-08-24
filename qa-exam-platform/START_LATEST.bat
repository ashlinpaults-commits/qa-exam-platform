@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo QA Exam Platform - Latest Version
echo ==========================================
echo.
echo Installing/verifying dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Check Node.js/npm and your internet connection.
  pause
  exit /b 1
)

echo.
echo Starting the latest development version...
echo Open the URL shown by Next.js in your browser.
echo Press Ctrl+C to stop the server.
echo.
call npm run dev

pause
