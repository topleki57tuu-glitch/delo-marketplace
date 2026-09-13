@echo off
chcp 65001 >nul
echo ================================================
echo   ДЕЛО Marketplace - Открыть Admin Dashboard
echo ================================================
echo.

:: Проверка запущен ли backend
echo Проверка сервисов...
curl -s http://localhost:8000/health >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Backend не запущен!
    echo.
    echo Запустите приложение с помощью start.bat
    echo.
    pause
    exit /b 1
)

curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Frontend не запущен!
    echo.
    echo Запустите приложение с помощью start.bat
    echo.
    pause
    exit /b 1
)

echo ✅ Сервисы работают
echo.
echo 🛡️  Открываю Admin Dashboard...
echo.
echo ================================================
echo   Учетные данные для входа:
echo ================================================
echo.
echo   Email:    admin@delo.ru
echo   Пароль:   demo123
echo.
echo ================================================
echo.

:: Открытие браузера с админ дашбордом
start http://localhost:3000/admin/dashboard

echo ✅ Браузер открыт с Admin Dashboard
echo.
echo 📊 Доступные функции:
echo    - Статистика платформы в реальном времени
echo    - Графики (рост пользователей, доход, категории)
echo    - Управление пользователями
echo    - Очереди (споры, верификация, выводы)
echo    - Последняя активность
echo.
echo 💡 Если не вошли автоматически:
echo    1. Нажмите "Вход" в правом верхнем углу
echo    2. Введите admin@delo.ru / demo123
echo    3. Нажмите кнопку "🛡️ Admin" в навигации
echo.
pause
