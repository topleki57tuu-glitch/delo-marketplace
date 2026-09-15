@echo off
echo ================================================
echo   DELO Marketplace - Stop Application
echo ================================================
echo.

echo [1/3] Stopping processes...

echo    Freeing port 8000 (Backend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo    Freeing port 3000 (Frontend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo    Stopping uvicorn (Backend)...
taskkill /F /IM uvicorn.exe >nul 2>&1

echo    Stopping Node.js (Frontend)...
taskkill /F /IM node.exe >nul 2>&1

echo    Stopping Python processes...
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1

timeout /t 2 >nul
echo Processes stopped
echo.

echo [2/3] Checking ports...
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 8000 is still busy
) else (
    echo Port 8000 is free
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 3000 is still busy
) else (
    echo Port 3000 is free
)
echo.

echo [3/3] Cleaning temporary files...
if exist "backend.pid" del /F /Q backend.pid >nul 2>&1
if exist "frontend.pid" del /F /Q frontend.pid >nul 2>&1
echo Temporary files removed
echo.

echo ================================================
echo   Application stopped successfully!
echo ================================================
echo.
echo Use start.bat to start the application
echo.
pause
