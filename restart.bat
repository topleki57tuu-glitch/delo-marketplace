@echo off
chcp 65001 >nul
echo ================================================
echo   ДЕЛО Marketplace - Перезапуск приложения
echo ================================================
echo.

echo [Шаг 1/2] Остановка приложения...
call stop.bat
echo.

echo [Шаг 2/2] Запуск приложения...
timeout /t 2 >nul
call start.bat
