#!/usr/bin/env bash
# ============================================================================
# Обновление уже развёрнутого маркетплейса «ДЕЛО» на VPS.
#
#   bash scripts/vps_update.sh
#
# Отличия от vps_deploy.sh: тот скрипт для ПЕРВОЙ установки — он перезаписывает
# .env, генерирует секреты и ставит Docker. Этот только подтягивает код,
# накатывает миграции и пересобирает образы. Существующий .env не трогается.
#
# Главное, зачем он нужен: `up -d --build` без миграций. Если в обновлении есть
# новая миграция, схема БД не обновится, и приложение упадёт на отсутствующей
# колонке. Здесь alembic вызывается всегда.
# ============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"

cd "$APP_DIR"

[ -f .env ] || { echo "Нет .env в $APP_DIR — сначала запустите scripts/vps_deploy.sh"; exit 1; }

echo "==> Обновление кода"
BEFORE="$(git rev-parse --short HEAD)"
git fetch origin main -q
git reset --hard origin/main -q
AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
    echo "    код не изменился ($AFTER)"
else
    echo "    $BEFORE -> $AFTER"
fi

echo "==> Проверка .env"
# Переменные, которые нужны в production, но могли не попасть в .env при
# первой установке (добавлены позже). Дописываем только недостающие.
#
# Домен читаем из .env: при вызове `bash scripts/vps_update.sh` окружение
# не экспортировано, и ${DOMAIN:-} подставил бы пустую строку — в .env уехал
# бы YOOMONEY_REDIRECT_URI=https:///payments/oauth/yoomoney.
ENV_DOMAIN="$(grep -m1 '^DOMAIN=' .env 2>/dev/null | cut -d= -f2- || true)"
changed_env=0
for kv in \
    "YOOMONEY_RETURN_PATH=/profile" \
    "YOOMONEY_REDIRECT_URI=https://${ENV_DOMAIN}/payments/oauth/yoomoney"
do
    k="${kv%%=*}"
    if ! grep -q "^${k}=" .env; then
        echo "    дописываю $k"
        echo "$kv" >> .env
        changed_env=1
    fi
done
[ "$changed_env" = "1" ] && echo "    .env дополнен (проверьте значения вручную!)"

echo "==> Сборка образов"
$COMPOSE build

echo "==> Запуск БД"
$COMPOSE up -d postgres
for i in $(seq 1 60); do
    if $COMPOSE exec -T postgres pg_isready >/dev/null 2>&1; then break; fi
    [ "$i" = 60 ] && { echo "postgres не поднялся"; $COMPOSE logs --tail 50 postgres; exit 1; }
    sleep 2
done
echo "    postgres готов"

echo "==> Миграции БД"
# Отдельный контейнер в сети compose до старта остальных сервисов, чтобы
# миграции не гонялись параллельно несколькими воркерами.
$COMPOSE run --rm --no-deps backend alembic upgrade head

echo "==> Перезапуск стека"
$COMPOSE up -d

echo "==> Ожидание backend"
for i in $(seq 1 60); do
    if $COMPOSE exec -T backend python -c \
        "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')" >/dev/null 2>&1; then
        break
    fi
    [ "$i" = 60 ] && { echo "backend не поднялся, логи:"; $COMPOSE logs --tail 50 backend; exit 1; }
    sleep 2
done
echo "    backend отвечает"

# Чистим старые образы, иначе на диске 9.76 ГБ место кончится за несколько
# обновлений: каждый build оставляет предыдущий слой.
echo "==> Очистка старых образов"
docker image prune -f >/dev/null 2>&1 || true

# Домен берём из .env, а не из окружения: при запуске через `bash script.sh`
# ничего не экспортировано, и любая непроверенная переменная под `set -u`
# роняет скрипт на последней строке (уже случалось).
SITE_URL="$(grep -m1 '^FRONTEND_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$SITE_URL" ] || SITE_URL="$(grep -m1 '^DOMAIN=' .env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$SITE_URL" ] || SITE_URL="(домен не задан)"

echo ""
echo "=========================================="
echo " Готово: $SITE_URL"
echo " Версия: $AFTER"
echo " Логи:   $COMPOSE logs -f backend"
echo "=========================================="
