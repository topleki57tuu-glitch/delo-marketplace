@echo off
chcp 65001 >nul
echo ================================================
echo   ДЕЛО Marketplace - Статус приложения
echo ================================================
echo.

:: Проверка Backend
echo [Backend - http://localhost:8000]
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Работает
    curl -s http://localhost:8000/health
) else (
    echo ❌ Не запущен
)
echo.

:: Проверка Frontend
echo [Frontend - http://localhost:3000]
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Работает
) else (
    echo ❌ Не запущен
)
echo.

:: Проверка портов
echo [Занятые порты]
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Порт 8000 (Backend) - ЗАНЯТ
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
        echo    PID: %%a
    )
) else (
    echo ⚪ Порт 8000 (Backend) - СВОБОДЕН
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Порт 3000 (Frontend) - ЗАНЯТ
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
        echo    PID: %%a
    )
) else (
    echo ⚪ Порт 3000 (Frontend) - СВОБОДЕН
)
echo.

:: Проверка процессов
echo [Запущенные процессы]
tasklist | findstr "uvicorn.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ uvicorn.exe (Backend) запущен
) else (
    echo ⚪ uvicorn.exe не найден
)

tasklist | findstr "node.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ node.exe (Frontend) запущен
) else (
    echo ⚪ node.exe не найден
)
echo.

:: Проверка базы данных
echo [База данных]
if exist "backend\delo.db" (
    echo ✅ backend\delo.db существует
) else (
    echo ❌ backend\delo.db не найдена
)
echo.

:: Проверка логов
echo [Логи]
if exist "backend\backend.log" (
    echo ✅ backend\backend.log
    for %%A in (backend\backend.log) do echo    Размер: %%~zA байт
) else (
    echo ⚪ backend\backend.log не найден
)

if exist "frontend\frontend.log" (
    echo ✅ frontend\frontend.log
    for %%A in (frontend\frontend.log) do echo    Размер: %%~zA байт
) else (
    echo ⚪ frontend\frontend.log не найден
)
echo.

echo ================================================
echo   Доступные команды:
echo ================================================
echo   start.bat       - Запустить приложение
echo   stop.bat        - Остановить приложение
echo   restart.bat     - Перезапустить приложение
echo   open-admin.bat  - Открыть Admin Dashboard
echo   status.bat      - Показать статус (этот файл)
echo ================================================
echo.
pause
