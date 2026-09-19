@echo off
echo ================================================
echo   DELO Marketplace - Start Application
echo ================================================
echo.

echo [1/5] Checking ports...
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 8000 is busy. Stopping process...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 >nul
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo Port 3000 is busy. Stopping process...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 >nul
)

taskkill /F /IM uvicorn.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 >nul

echo Ports are free
echo.

if not exist "backend" (
    echo Error: backend directory not found!
    pause
    exit /b 1
)

if not exist "frontend" (
    echo Error: frontend directory not found!
    pause
    exit /b 1
)

echo [2/5] Starting Backend (FastAPI)...
cd backend
REM Явно включаем режим разработки. Без этой строки приложение считает
REM окружение боевым (fail-closed в app/core/config.py) и отказывается
REM стартовать без SECRET_KEY — это защита от запуска прода без настройки.
set ENV=development
REM Имя файла базы должно совпадать с DATABASE_URL (по умолчанию
REM sqlite:///./marketplace_v3.db, см. backend/app/core/config.py).
REM Здесь раньше стояло delo.db — файла с таким именем не бывает, поэтому
REM условие было всегда истинным и seed_demo.py запускался при КАЖДОМ старте,
REM а он чистит все таблицы (DELETE FROM): демо-данные и всё, что наиграно,
REM стирались при каждом запуске.
set DB_FILE=marketplace_v3.db
if not exist "%DB_FILE%" (
    echo Creating demo database...
    if "%DEMO_PASSWORD%"=="" (
        echo.
        echo   DEMO_PASSWORD not set - generating a random one.
        echo   The generated password is printed below and stored in
        echo   backend\demo_password.txt so you can log in.
        echo.
    )
    python seed_demo.py
)

start /B cmd /c "set ENV=development && python -m uvicorn main:app --host 0.0.0.0 --port 8000 > backend.log 2>&1"
cd ..

echo Waiting for backend...
timeout /t 3 >nul

curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo Backend started: http://localhost:8000
) else (
    echo Backend is starting...
)
echo.

echo [3/5] Starting Frontend (Vite + React)...
cd frontend
start /B cmd /c "npm run dev > frontend.log 2>&1"
cd ..

echo Waiting for frontend...
timeout /t 5 >nul

curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo Frontend started: http://localhost:3000
) else (
    echo Frontend is starting...
)
echo.

echo [4/5] Checking services...
timeout /t 2 >nul

curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo Backend: OK
) else (
    echo Backend: Not responding
)

curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo Frontend: OK
) else (
    echo Frontend: Not responding
)
echo.

echo [5/5] Opening browser...
echo.
echo ================================================
echo   Application started successfully!
echo ================================================
echo.
echo URLs:
echo    Frontend:  http://localhost:3000
echo    Backend:   http://localhost:8000
echo    API Docs:  http://localhost:8000/docs
echo    Admin:     http://localhost:3000/admin/dashboard
echo.
echo Demo accounts:
echo    Admin:       admin@delo.ru
echo    Customer:    anna@delo.ru
echo    Specialist:  igor@delo.ru
echo.
echo Password: see backend\demo_password.txt
echo    (set DEMO_PASSWORD before seeding to choose your own)
echo.
if exist "backend\demo_password.txt" (
    echo    --- backend\demo_password.txt ---
    type "backend\demo_password.txt"
    echo    ---------------------------------
    echo.
)
echo Logs:
echo    Backend:  backend\backend.log
echo    Frontend: frontend\frontend.log
echo.
echo Do not close this window while app is running!
echo Use stop.bat to stop the application
echo.
echo ================================================

timeout /t 2 >nul
start http://localhost:3000

echo.
echo Press Ctrl+C to exit (app will continue in background)
echo Or use stop.bat to fully stop the application
echo.
pause >nul
