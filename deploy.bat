@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace
set SITE=https://xn--d1acsm.online

REM Always use the full path to system ssh.exe.
REM A bare `ssh` is not enough: cmd.exe resolves executables in the
REM CURRENT directory first. If ssh.bat/ssh.cmd sits next to this file,
REM that one runs instead of the Windows OpenSSH client - which made
REM deploy.bat loop on the ssh.bat banner instead of connecting.
set SSH="%SystemRoot%\System32\OpenSSH\ssh.exe"

echo ================================================
echo   DELO - Deploy update to production server
echo ================================================
echo.
echo   Server: %SERVER%
echo   Path:   %APPDIR%
echo   Site:   %SITE%
echo.

echo [1/3] Checking server...
%SSH% -o ConnectTimeout=15 -o BatchMode=no %SERVER% "test -f %APPDIR%/scripts/vps_update.sh"
if errorlevel 1 (
    echo.
    echo   ERROR: server unreachable, or vps_update.sh is not on the server yet.
    echo.
    echo   If the server answers but the script is missing, run once:
    echo     server-shell.bat
    echo     cd %APPDIR% ^&^& git pull origin main
    echo.
    pause
    exit /b 1
)
echo   OK
echo.

echo [2/3] Updating. Rebuild takes a few minutes - do not close the window.
echo ----------------------------------------------------------------
%SSH% %SERVER% "cd %APPDIR% && bash scripts/vps_update.sh"
if errorlevel 1 (
    echo ----------------------------------------------------------------
    echo   ERROR: update failed, see output above.
    echo.
    echo   Diagnostics:
    echo     %SSH% %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml ps"
    echo     %SSH% %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml logs --tail 50 backend"
    echo.
    pause
    exit /b 1
)
echo ----------------------------------------------------------------
echo   OK
echo.

echo [3/3] Checking site over HTTPS...
curl -s -o nul -w "  /health  HTTP %%{http_code}\n" %SITE%/health
curl -s %SITE%/health
echo.
echo.

echo ================================================
echo   Done.
echo ================================================
echo   Site:    %SITE%
echo   Status:  status-server.bat
echo   Logs:    logs.bat
echo   Shell:   server-shell.bat
echo ================================================
echo.
pause
