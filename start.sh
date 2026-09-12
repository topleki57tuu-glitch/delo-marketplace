#!/bin/bash
# Скрипт запуска ДЕЛО Marketplace на тестовом сервере

set -e  # Остановка при ошибке

echo "=== ДЕЛО Marketplace - Deployment Script ==="
echo "Дата: $(date)"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Проверка .env файла
if [ ! -f .env ]; then
    echo -e "${RED}❌ Файл .env не найден!${NC}"
    echo "Скопируйте .env.example и настройте переменные окружения"
    exit 1
fi

echo -e "${GREEN}✓${NC} Файл .env найден"

# Проверка обязательных переменных
source .env
if [ -z "$SECRET_KEY" ] || [ "$SECRET_KEY" == "change_me_to_random_string" ]; then
    echo -e "${RED}❌ SECRET_KEY не настроен!${NC}"
    echo "Запустите: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    exit 1
fi

echo -e "${GREEN}✓${NC} SECRET_KEY настроен"

# Шаг 1: Запуск PostgreSQL и Redis
echo ""
echo -e "${YELLOW}[1/6]${NC} Запуск PostgreSQL и Redis..."
docker-compose -f docker-compose.infra.yml up -d

# Ожидание готовности баз данных
echo "Ожидание готовности PostgreSQL..."
until docker exec marketplace_postgres pg_isready -U marketplace_user -d marketplace_db > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

echo "Ожидание готовности Redis..."
until docker exec marketplace_redis redis-cli ping > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Шаг 2: Установка зависимостей backend
echo ""
echo -e "${YELLOW}[2/6]${NC} Установка зависимостей backend..."
cd backend
pip install -r requirements.txt --quiet
echo -e "${GREEN}✓${NC} Зависимости установлены"

# Шаг 3: Применение миграций БД
echo ""
echo -e "${YELLOW}[3/6]${NC} Применение миграций базы данных..."
alembic upgrade head
echo -e "${GREEN}✓${NC} Миграции применены"

# Шаг 4: Засеять демо-данные (опционально)
if [ "$SEED_DEMO" == "1" ]; then
    echo ""
    echo -e "${YELLOW}[4/6]${NC} Засев демо-данных..."
    python seed_demo.py
    echo -e "${GREEN}✓${NC} Демо-данные добавлены"
else
    echo ""
    echo -e "${YELLOW}[4/6]${NC} Пропуск демо-данных (SEED_DEMO=0)"
fi

# Шаг 5: Сборка frontend
echo ""
echo -e "${YELLOW}[5/6]${NC} Сборка frontend..."
cd ../frontend
npm install --quiet
npm run build
echo -e "${GREEN}✓${NC} Frontend собран"

# Шаг 6: Запуск backend
echo ""
echo -e "${YELLOW}[6/6]${NC} Запуск backend сервера..."
cd ../backend

# Проверка режима запуска
if [ "$1" == "--dev" ]; then
    echo "Режим: Development (с auto-reload)"
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
else
    echo "Режим: Production (4 воркера)"
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
fi
