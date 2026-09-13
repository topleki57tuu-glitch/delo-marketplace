@echo off
chcp 65001 >nul
echo ================================================
echo   ДЕЛО Marketplace - Остановка приложения
echo ================================================
echo.

echo [1/3] Остановка процессов...

:: Остановка процессов на портах
echo    Освобождение порта 8000 (Backend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo    Освобождение порта 3000 (Frontend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Остановка процессов по имени
echo    Остановка uvicorn (Backend)...
taskkill /F /IM uvicorn.exe >nul 2>&1

echo    Остановка Node.js (Frontend)...
taskkill /F /IM node.exe >nul 2>&1

echo    Остановка Python процессов...
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1

timeout /t 2 >nul
echo ✅ Процессы остановлены
echo.

:: Проверка портов
echo [2/3] Проверка портов...
netstat -ano | findstr ":8000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  Порт 8000 все еще занят
) else (
    echo ✅ Порт 8000 свободен
)

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  Порт 3000 все еще занят
) else (
    echo ✅ Порт 3000 свободен
)
echo.

:: Удаление PID файлов
echo [3/3] Очистка временных файлов...
if exist "backend.pid" del /F /Q backend.pid >nul 2>&1
if exist "frontend.pid" del /F /Q frontend.pid >nul 2>&1
echo ✅ Временные файлы удалены
echo.

echo ================================================
echo   ✅ Приложение успешно остановлено!
echo ================================================
echo.
echo Для запуска используйте start.bat
echo.
pause
