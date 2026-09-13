@echo off
chcp 65001 >nul
echo ================================================
echo   ДЕЛО Marketplace - Запуск приложения
echo ================================================
echo.

:: Проверка и остановка старых процессов
echo [1/5] Проверка запущенных процессов...
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  Порт 8000 занят. Останавливаю процесс...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 >nul
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  Порт 3000 занят. Останавливаю процесс...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 >nul
)

:: Остановка процессов по имени
taskkill /F /IM uvicorn.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 >nul

echo ✅ Порты освобождены
echo.

:: Проверка существования директорий
if not exist "backend" (
    echo ❌ Ошибка: Директория backend не найдена!
    echo    Запустите скрипт из корневой директории проекта
    pause
    exit /b 1
)

if not exist "frontend" (
    echo ❌ Ошибка: Директория frontend не найдена!
    echo    Запустите скрипт из корневой директории проекта
    pause
    exit /b 1
)

:: Запуск Backend
echo [2/5] Запуск Backend (FastAPI)...
cd backend
if not exist "delo.db" (
    echo ⚠️  База данных не найдена. Создаю демо-данные...
    python seed_demo.py
)

start /B cmd /c "python -m uvicorn main:app --host 0.0.0.0 --port 8000 > backend.log 2>&1"
cd ..

:: Ожидание запуска backend
echo    Ожидание запуска backend...
timeout /t 3 >nul

:: Проверка backend
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend запущен на http://localhost:8000
) else (
    echo ⚠️  Backend запускается... (может потребоваться несколько секунд)
)
echo.

:: Запуск Frontend
echo [3/5] Запуск Frontend (Vite + React)...
cd frontend
start /B cmd /c "npm run dev > frontend.log 2>&1"
cd ..

:: Ожидание запуска frontend
echo    Ожидание запуска frontend...
timeout /t 5 >nul

:: Проверка frontend
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend запущен на http://localhost:3000
) else (
    echo ⚠️  Frontend запускается... (может потребоваться несколько секунд)
)
echo.

:: Финальная проверка
echo [4/5] Проверка сервисов...
timeout /t 2 >nul

curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend: OK
) else (
    echo ❌ Backend: Не отвечает
)

curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend: OK
) else (
    echo ❌ Frontend: Не отвечает
)
echo.

:: Открытие браузера
echo [5/5] Открытие приложения в браузере...
echo.
echo ================================================
echo   ✅ Приложение успешно запущено!
echo ================================================
echo.
echo 🌐 Доступные URL:
echo    Frontend:  http://localhost:3000
echo    Backend:   http://localhost:8000
echo    API Docs:  http://localhost:8000/docs
echo    Admin:     http://localhost:3000/admin/dashboard
echo.
echo 👤 Демо-аккаунты (пароль для всех: demo123):
echo    Админ:       admin@delo.ru
echo    Заказчик:    anna@delo.ru
echo    Специалист:  igor@delo.ru
echo.
echo 📊 Логи:
echo    Backend:  backend\backend.log
echo    Frontend: frontend\frontend.log
echo.
echo ⚠️  Не закрывайте это окно, пока приложение работает!
echo    Для остановки используйте stop.bat
echo.
echo ================================================

:: Открытие браузера через 2 секунды
timeout /t 2 >nul
start http://localhost:3000

:: Держим окно открытым
echo.
echo Нажмите Ctrl+C для выхода (приложение продолжит работу в фоне)
echo Или используйте stop.bat для полной остановки
echo.
pause >nul
