@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace
set SITE=https://xn--d1acsm.online

REM Full path to ssh.exe - see comment in deploy.bat.
set SSH="%SystemRoot%\System32\OpenSSH\ssh.exe"

echo ================================================
echo   DELO - Roll back to the previous version
echo ================================================
echo.
echo   Returns the version that worked before the last update.
echo   The server shows both versions and asks to confirm.
echo   Rebuild takes a few minutes - do not close the window.
echo.

REM -t: the server script asks "Rollback? [Y/n]" - it needs a terminal.
%SSH% -t %SERVER% "cd %APPDIR% && bash scripts/vps_update.sh --rollback"
if errorlevel 1 (
    echo.
    echo   Rollback did not complete - see output above.
    echo   Journal of updates:
    echo     %SSH% %SERVER% "cd %APPDIR% && bash scripts/vps_update.sh --history"
    echo.
    pause
    exit /b 1
)
echo.
echo [Check] %SITE%/health
curl -s -o nul -w "  /health  HTTP %%{http_code}\n" %SITE%/health
echo.
pause
