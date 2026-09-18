@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace

echo ================================================
echo   DELO - Backend logs (last 50 lines)
echo ================================================
echo.
ssh %SERVER% "cd %APPDIR% && docker compose -f docker-compose.prod.yml logs --tail 50 backend"
echo.
echo ================================================
echo   For a live tail run inside the server:
echo     cd /opt/delo-marketplace
echo     docker compose -f docker-compose.prod.yml logs -f backend
echo ================================================
echo.
pause
