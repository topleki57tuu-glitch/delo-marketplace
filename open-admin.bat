@echo off
echo ================================================
echo   DELO Marketplace - Open Admin Dashboard
echo ================================================
echo.

echo Checking services...
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% neq 0 (
    echo Backend is not running!
    echo.
    echo Please start the application using start.bat
    echo.
    pause
    exit /b 1
)

curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo Frontend is not running!
    echo.
    echo Please start the application using start.bat
    echo.
    pause
    exit /b 1
)

echo Services are running
echo.
echo Opening Admin Dashboard...
echo.
echo ================================================
echo   Login credentials:
echo ================================================
echo.
echo   Email:    admin@delo.ru
echo   Password: see backend\demo_password.txt
echo             (or the DEMO_PASSWORD env var)
echo.
if exist "backend\demo_password.txt" (
    echo   --- backend\demo_password.txt ---
    type "backend\demo_password.txt"
    echo   ---------------------------------
    echo.
)
echo ================================================
echo.

start http://localhost:3000/admin/dashboard

echo Browser opened with Admin Dashboard
echo.
echo Available features:
echo    - Real-time platform statistics
echo    - Charts (user growth, revenue, categories)
echo    - User management
echo    - Queues (disputes, verification, withdrawals)
echo    - Recent activity
echo.
echo If not logged in automatically:
echo    1. Click "Login" in the top right corner
echo    2. Enter admin@delo.ru + the password shown above
echo    3. Click "Admin" button in navigation
echo.
pause
