@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145

REM Full path to ssh.exe - see comment in deploy.bat.
set SSH="%SystemRoot%\System32\OpenSSH\ssh.exe"

echo ================================================
echo   DELO - Shell on production server
echo ================================================
echo.
echo   %SERVER%  (Ubuntu 22.04)
echo.
echo   Useful once inside:
echo     cd /opt/delo-marketplace
echo     bash scripts/vps_update.sh           - update app
echo     docker compose -f docker-compose.prod.yml ps
echo     docker compose -f docker-compose.prod.yml logs -f backend
echo     nano .env                            - edit secrets
echo.
echo   To exit: type  exit
echo.
echo   Connecting now...
echo.
%SSH% %SERVER%
echo.
echo   Disconnected.
pause
