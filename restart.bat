@echo off
echo ================================================
echo   DELO Marketplace - Restart Application
echo ================================================
echo.

echo [Step 1/2] Stopping application...
call stop.bat
echo.

echo [Step 2/2] Starting application...
timeout /t 2 >nul
call start.bat
