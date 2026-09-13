@echo off
echo ====================================
echo Deploy delo-marketplace
echo ====================================
echo.

echo [1/5] Checking files...
if not exist "backend" (
    echo ERROR: backend folder not found
    pause
    exit /b 1
)
if not exist "frontend\dist" (
    echo ERROR: frontend\dist folder not found
    pause
    exit /b 1
)
echo OK: Files found
echo.

echo [2/5] Cleaning server...
ssh root@213.21.229.145 "pkill -f uvicorn; rm -rf /var/www/delomaster.online/backend/*; rm -rf /var/www/delomaster.online/frontend/*; mkdir -p /var/www/delomaster.online/backend; mkdir -p /var/www/delomaster.online/frontend; echo 'Server cleaned'"
if errorlevel 1 (
    echo ERROR: Cannot connect to server
    pause
    exit /b 1
)
echo OK: Server cleaned
echo.

echo [3/5] Uploading frontend...
scp -r frontend\dist\* root@213.21.229.145:/var/www/delomaster.online/frontend/
if errorlevel 1 (
    echo ERROR: Cannot upload frontend
    pause
    exit /b 1
)
echo OK: Frontend uploaded
echo.

echo [4/5] Uploading backend...
scp -r backend\* root@213.21.229.145:/var/www/delomaster.online/backend/
if errorlevel 1 (
    echo ERROR: Cannot upload backend
    pause
    exit /b 1
)
echo OK: Backend uploaded
echo.

echo [5/5] Starting backend...
ssh root@213.21.229.145 "cd /var/www/delomaster.online/backend && pip3 install -r requirements.txt && nohup uvicorn main:app --host 0.0.0.0 --port 8000 > /var/log/backend.log 2>&1 & echo 'Backend started'"
echo.

echo Restarting nginx...
ssh root@213.21.229.145 "nginx -t && systemctl restart nginx && echo 'Nginx restarted'"
echo.

echo ====================================
echo Deploy completed!
echo ====================================
echo.
echo Check site: http://delomaster.online
echo.
pause
