#!/usr/bin/env bash
# ============================================================================
# Развёртывание маркетплейса «ДЕЛО» на своём VPS (Ubuntu/Debian) одной командой:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/topleki57tuu-glitch/delo-marketplace/main/scripts/vps_deploy.sh)
#
# или с уже склонированным репозиторием:
#   bash scripts/vps_deploy.sh
#
# Скрипт: ставит Docker, клонирует/обновляет репозиторий, генерирует .env
# со случайными секретами, поднимает стек (Caddy + frontend + backend +
# postgres + redis + bot) и, по желанию, насыпает демо-данные.
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/topleki57tuu-glitch/delo-marketplace.git"
APP_DIR="/opt/delo-marketplace"

[ "$(id -u)" -eq 0 ] || { echo "Запускайте от root: sudo bash $0"; exit 1; }

echo "==> Установка базовых пакетов"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl openssl >/dev/null

echo "==> Docker"
if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose недоступен"; exit 1; }

echo "==> Код приложения"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch origin main
    git -C "$APP_DIR" reset --hard origin/main
else
    rm -rf "$APP_DIR"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> Конфигурация .env"
if [ ! -f .env ]; then
    read -rp "Домен сайта (Enter — если нет, будет HTTP по IP): " DOMAIN
    DOMAIN="${DOMAIN##*://}"; DOMAIN="${DOMAIN%%/*}"
    SECRET_KEY="$(openssl rand -hex 48)"
    PG_PASSWORD="$(openssl rand -hex 24)"
    if [ -n "$DOMAIN" ]; then
        PUBLIC_URL="https://$DOMAIN"
    else
        PUBLIC_URL="http://$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
    fi
    cat > .env <<EOF
ENV=production
SECRET_KEY=$SECRET_KEY
DOMAIN=$DOMAIN
POSTGRES_USER=marketplace
POSTGRES_PASSWORD=$PG_PASSWORD
POSTGRES_DB=marketplace_db
FRONTEND_URL=$PUBLIC_URL
CORS_ORIGINS=$PUBLIC_URL
ADMIN_EMAILS=admin@delo.ru
TELEGRAM_BOT_TOKEN=
EOF
    chmod 600 .env
    echo "    .env создан (секреты сгенерированы). URL: $PUBLIC_URL"
else
    echo "    используется существующий .env"
fi
set -a; . ./.env; set +a

echo "==> Caddyfile (домен: $DOMAIN)"
if [ -n "${DOMAIN:-}" ]; then
    cp deploy/Caddyfile.domain deploy/Caddyfile
else
    cp deploy/Caddyfile.http deploy/Caddyfile
fi

echo "==> Сборка и запуск стека"
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Ожидание backend"
for i in $(seq 1 60); do
    if docker compose -f docker-compose.prod.yml exec -T backend python -c \
        "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')" >/dev/null 2>&1; then
        break
    fi
    [ "$i" = 60 ] && { echo "backend не поднялся, логи:"; docker compose -f docker-compose.prod.yml logs --tail 50 backend; exit 1; }
    sleep 2
done
echo "    backend отвечает"

read -rp "Насыпать демо-данные (перезапишет базу!)? [y/N]: " SEED
if [ "${SEED:-n}" = "y" ]; then
    docker compose -f docker-compose.prod.yml exec -T backend python seed_demo.py
    echo "    Демо-аккаунты: igor@delo.ru / demo123 (полный список в README)"
fi

echo ""
echo "=========================================="
echo " Готово: $FRONTEND_URL"
echo " Логи:   docker compose -f docker-compose.prod.yml logs -f backend"
echo " Апдейт: git pull && docker compose -f docker-compose.prod.yml up -d --build"
echo "=========================================="
