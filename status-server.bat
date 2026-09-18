@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace

echo ================================================
echo   DELO - Server status
echo ================================================
echo.
echo [Site] https://xn--d1acsm.online
curl -s -o nul -w "  /        -> %%{http_code}\n" https://xn--d1acsm.online/
curl -s -o nul -w "  /health  -> %%{http_code}\n" https://xn--d1acsm.online/health
curl -s -o nul -w "  /tasks/  -> %%{http_code}\n" https://xn--d1acsm.online/tasks/
curl -s -o nul -w "  /products/ -> %%{http_code}\n" https://xn--d1acsm.online/products/
echo.

echo [Payments]
curl -s https://xn--d1acsm.online/payments/status
echo.
echo   configured:false means the tokens are not set in .env yet
echo.

echo [Containers on server]
ssh %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml ps"
echo.

echo [Disk on server]
ssh %SERVER% "df -h / | tail -1"
echo.

echo [Git version on server]
ssh %SERVER% "cd %APPDIR% && git log --oneline -1"
echo.
pause
