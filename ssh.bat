@echo off
echo ================================================
echo   DELO - SSH to production server
echo ================================================
echo.
echo   root@213.21.229.145  (Ubuntu 22.04)
echo.
echo   Useful once inside:
echo     cd /opt/delo-marketplace
echo     bash scripts/vps_update.sh          - update app
echo     docker compose -f docker-compose.prod.yml ps
echo     docker compose -f docker-compose.prod.yml logs -f backend
echo     nano .env                           - edit secrets
echo.
echo   To exit SSH: type  exit
echo.
pause
ssh root@213.21.229.145
