@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace
set SITE=https://xn--d1acsm.online

REM Full path to ssh.exe - see comment in deploy.bat.
set SSH="%SystemRoot%\System32\OpenSSH\ssh.exe"

echo ================================================
echo   DELO - Server status
echo ================================================
echo.
echo [Site] %SITE%
curl -s -o nul -w "  /           HTTP %%{http_code}\n" %SITE%/
curl -s -o nul -w "  /health     HTTP %%{http_code}\n" %SITE%/health
curl -s -o nul -w "  /tasks/     HTTP %%{http_code}\n" %SITE%/tasks/
curl -s -o nul -w "  /products/  HTTP %%{http_code}\n" %SITE%/products/
echo.

echo [Payments]
curl -s %SITE%/payments/status
echo.
echo   configured:false means the tokens are NOT set in .env yet.
echo.

echo [Containers]
%SSH% %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml ps"
echo.

echo [Disk]
%SSH% %SERVER% "df -h / | tail -1"
echo.

echo [Version on server]
%SSH% %SERVER% "cd %APPDIR% && git log --oneline -1"
echo.
pause
