@echo off
chcp 65001 >nul
setlocal
echo ================================================
echo   DELO - Deploy update to production server
echo ================================================
echo.
echo   Server: root@213.21.229.145
echo   Path:   /opt/delo-marketplace
echo   Site:   https://xn--d1acsm.online
echo.

set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace

echo [1/3] Connecting and checking server path...
ssh %SERVER% "test -f %APPDIR%/scripts/vps_update.sh" 2>nul
if errorlevel 1 (
    echo.
    echo   ERROR: vps_update.sh not found on server.
    echo   Run once inside the server:
    echo     cd %APPDIR% ^&^& git pull origin main
    echo.
    pause
    exit /b 1
)
echo   OK - script found
echo.

echo [2/3] Pulling code and rebuilding (this takes a few minutes)...
echo ----------------------------------------------------------------
ssh %SERVER% "cd %APPDIR% && bash scripts/vps_update.sh"
if errorlevel 1 (
    echo ----------------------------------------------------------------
    echo   ERROR: update failed. See output above.
    echo.
    echo   Useful commands:
    echo     ssh %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml logs --tail 50 backend"
    echo     ssh %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml ps"
    echo.
    pause
    exit /b 1
)
echo ----------------------------------------------------------------
echo   OK - update finished
echo.

echo [3/3] Checking site over HTTPS...
curl -s -o nul -w "  HTTPS status: %%{http_code}\n" https://xn--d1acsm.online/health
curl -s https://xn--d1acsm.online/health
echo.
echo.

echo ================================================
echo   Done.
echo ================================================
echo   Site:    https://xn--d1acsm.online
echo   Update:  deploy.bat (this file)
echo   Logs:    logs.bat
echo   Shell:   ssh.bat
echo ================================================
echo.
pause
