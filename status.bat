@echo off
echo ================================================
echo   DELO Marketplace - Application Status
echo ================================================
echo.

echo [Backend - http://localhost:8000]
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo Running
    curl -s http://localhost:8000/health
) else (
    echo Not running
)
echo.

echo [Frontend - http://localhost:3000]
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo Running
) else (
    echo Not running
)
echo.

echo [Ports]
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 8000 (Backend) - BUSY
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
        echo    PID: %%a
    )
) else (
    echo Port 8000 (Backend) - FREE
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 3000 (Frontend) - BUSY
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
        echo    PID: %%a
    )
) else (
    echo Port 3000 (Frontend) - FREE
)
echo.

echo [Processes]
tasklist | findstr "uvicorn.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo uvicorn.exe (Backend) is running
) else (
    echo uvicorn.exe not found
)

tasklist | findstr "node.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo node.exe (Frontend) is running
) else (
    echo node.exe not found
)
echo.

echo [Database]
REM Имя должно совпадать с DATABASE_URL (см. backend/app/core/config.py).
REM Раньше здесь было delo.db, поэтому отчёт всегда показывал
REM "not found", даже когда база на месте.
if exist "backend\marketplace_v3.db" (
    echo backend\marketplace_v3.db exists
) else (
    echo backend\marketplace_v3.db not found
)
echo.

echo [Logs]
if exist "backend\backend.log" (
    echo backend\backend.log
    for %%A in (backend\backend.log) do echo    Size: %%~zA bytes
) else (
    echo backend\backend.log not found
)

if exist "frontend\frontend.log" (
    echo frontend\frontend.log
    for %%A in (frontend\frontend.log) do echo    Size: %%~zA bytes
) else (
    echo frontend\frontend.log not found
)
echo.

echo ================================================
echo   Available commands:
echo ================================================
echo   start.bat       - Start application
echo   stop.bat        - Stop application
echo   restart.bat     - Restart application
echo   open-admin.bat  - Open Admin Dashboard
echo   status.bat      - Show status (this file)
echo ================================================
echo.
pause
