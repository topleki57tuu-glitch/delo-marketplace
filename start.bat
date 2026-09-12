@echo off
REM Скрипт запуска ДЕЛО Marketplace на Windows

echo === ДЕЛО Marketplace - Deployment Script ===
echo Дата: %date% %time%
echo.

REM Проверка .env файла
if not exist .env (
    echo [ERROR] Файл .env не найден!
    echo Скопируйте .env.example и настройте переменные окружения
    exit /b 1
)

echo [OK] Файл .env найден

REM Шаг 1: Запуск PostgreSQL и Redis
echo.
echo [1/6] Запуск PostgreSQL и Redis...

REM Проверка Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker не установлен или не запущен!
    echo.
    echo Установите Docker Desktop для Windows:
    echo https://www.docker.com/products/docker-desktop
    echo.
    echo Или запустите Docker Desktop, если он уже установлен.
    pause
    exit /b 1
)

docker compose -f docker-compose.infra.yml up -d

REM Ожидание готовности баз данных
echo Ожидание готовности PostgreSQL...
:wait_postgres
docker exec marketplace_postgres pg_isready -U marketplace_user -d marketplace_db >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_postgres
)
echo [OK] PostgreSQL готов

echo Ожидание готовности Redis...
:wait_redis
docker exec marketplace_redis redis-cli ping >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_redis
)
echo [OK] Redis готов

REM Шаг 2: Установка зависимостей backend
echo.
echo [2/6] Установка зависимостей backend...
cd backend
pip install -r requirements.txt --quiet
echo [OK] Зависимости установлены

REM Шаг 3: Применение миграций БД
echo.
echo [3/6] Применение миграций базы данных...
alembic upgrade head
echo [OK] Миграции применены

REM Шаг 4: Пропуск демо-данных
echo.
echo [4/6] Пропуск демо-данных (установите SEED_DEMO=1 для засева)

REM Шаг 5: Сборка frontend
echo.
echo [5/6] Сборка frontend...
cd ..\frontend
call npm install --quiet
call npm run build
echo [OK] Frontend собран

REM Шаг 6: Запуск backend
echo.
echo [6/6] Запуск backend сервера...
cd ..\backend

if "%1"=="--dev" (
    echo Режим: Development (с auto-reload)
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
) else (
    echo Режим: Production (4 воркера)
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
)
