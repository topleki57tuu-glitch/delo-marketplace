@echo off
REM Быстрый запуск ДЕЛО Marketplace БЕЗ Docker (только для тестирования)
REM Использует SQLite вместо PostgreSQL, без Redis

echo === ДЕЛО Marketplace - Quick Start (без Docker) ===
echo Дата: %date% %time%
echo.

REM Проверка .env файла
if not exist .env (
    echo [ERROR] Файл .env не найден!
    exit /b 1
)

echo [OK] Файл .env найден
echo.
echo [ВНИМАНИЕ] Запуск в режиме разработки (SQLite + без Redis)
echo Для production используйте start.bat с Docker
echo.

REM Установка зависимостей backend
echo [1/3] Установка зависимостей backend...
cd backend
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [ERROR] Не удалось установить зависимости
    pause
    exit /b 1
)
echo [OK] Зависимости установлены

REM Применение миграций БД (SQLite)
echo.
echo [2/3] Создание базы данных (SQLite)...
python -c "from app.core.database import engine, Base; from app.models import *; Base.metadata.create_all(bind=engine); print('[OK] База данных создана')"
if errorlevel 1 (
    echo [ERROR] Не удалось создать базу данных
    pause
    exit /b 1
)

REM Засеять демо-данные
echo.
echo [3/3] Засев демо-данных...
python seed_demo.py
if errorlevel 1 (
    echo [WARNING] Демо-данные не удалось засеять
)

REM Запуск backend
echo.
echo ========================================
echo Запуск сервера...
echo.
echo Frontend + Backend: http://localhost:8000
echo API Docs: http://localhost:8000/docs
echo Health Check: http://localhost:8000/health
echo.
echo Демо-аккаунты (пароль: demo123):
echo - anna@delo.ru (заказчик)
echo - igor@delo.ru (специалист PRO)
echo - admin@delo.ru (арбитр)
echo.
echo ========================================
echo.

REM Запуск с auto-reload
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
