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

# Приводит домен к punycode (IDN -> ASCII).
# Caddy не принимает юникод в адресе сайта, Let's Encrypt выдаёт сертификаты
# только на xn--..., а backend сравнивает Origin буквально. Поэтому кириллица
# в .env — это тихая поломка сразу в трёх местах, а не косметика.
to_punycode() {
    local d="$1"
    # уже ASCII — отдаём как есть
    if LC_ALL=C grep -qP '^[\x00-\x7F]+$' <<<"$d" 2>/dev/null; then
        echo "$d"; return
    fi
    if command -v python3 >/dev/null; then
        python3 -c "import sys;print(sys.argv[1].encode('idna').decode())" "$d" 2>/dev/null && return
    fi
    if command -v idn2 >/dev/null; then
        idn2 "$d" 2>/dev/null && return
    fi
    echo "$d"
}

[ "$(id -u)" -eq 0 ] || { echo "Запускайте от root: sudo bash $0"; exit 1; }

echo "==> Установка базовых пакетов"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl openssl python3 >/dev/null

echo "==> Docker"
# Проверять надо наличие ПЛАГИНА compose, а не бинарника docker.
# На образах хостингов docker часто уже стоит, но без compose v2 — в таком
# случае проверка `command -v docker` проходит, установка пропускается,
# и скрипт падает на «Docker Compose недоступен». Ставим плагин отдельно.
if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "    плагин docker compose отсутствует — устанавливаю"
    apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || true
    if ! docker compose version >/dev/null 2>&1; then
        # запасной путь для образов без репозитория Docker
        curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)" \
            -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || {
            mkdir -p /usr/local/lib/docker/cli-plugins
            curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)" \
                -o /usr/local/lib/docker/cli-plugins/docker-compose
        }
        chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    fi
fi
docker compose version >/dev/null 2>&1 || {
    echo "Не удалось поставить docker compose. Установите вручную:"
    echo "  apt-get install -y docker-compose-plugin"
    echo "  или: curl -fsSL https://get.docker.com | sh"
    exit 1
}

# Демон должен быть запущен, иначе сборка упадёт «Cannot connect to the Docker daemon»
systemctl enable --now docker >/dev/null 2>&1 || true

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
    read -rp "Домен сайта (Enter — если нет, будет HTTP по IP): " DOMAIN_RAW
    DOMAIN_RAW="${DOMAIN_RAW##*://}"; DOMAIN_RAW="${DOMAIN_RAW%%/*}"
    DOMAIN="$(to_punycode "$DOMAIN_RAW")"
    [ -n "$DOMAIN_RAW" ] && [ "$DOMAIN" != "$DOMAIN_RAW" ] && \
        echo "    IDN: $DOMAIN_RAW -> $DOMAIN (punycode)"
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
    # Раньше DOMAIN заполнялся только при создании нового .env, поэтому на
    # повторном запуске с существующим .env он оставался пустым: скрипт молча
    # ставил Caddyfile.http и сайт поднимался без HTTPS/домена. Более того,
    # docker-compose.prod.yml монтирует ./deploy/Caddyfile, а этого файла в
    # репозитории нет (он генерируется) — docker compose падал на монтировании.
    if ! grep -q '^DOMAIN=' .env; then
        read -rp "Домен сайта (Enter — если нет, будет HTTP по IP): " DOMAIN_RAW
        DOMAIN_RAW="${DOMAIN_RAW##*://}"; DOMAIN_RAW="${DOMAIN_RAW%%/*}"
        DOMAIN="$(to_punycode "$DOMAIN_RAW")"
        [ -n "$DOMAIN_RAW" ] && [ "$DOMAIN" != "$DOMAIN_RAW" ] && \
            echo "    IDN: $DOMAIN_RAW -> $DOMAIN (punycode)"
        if [ -n "$DOMAIN" ]; then
            PUBLIC_URL="https://$DOMAIN"
        else
            PUBLIC_URL="http://$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
        fi
        {
            echo "DOMAIN=$DOMAIN"
            echo "FRONTEND_URL=$PUBLIC_URL"
            echo "CORS_ORIGINS=$PUBLIC_URL"
        } >> .env
        echo "    .env дополнен: DOMAIN=$DOMAIN"
    else
        echo "    DOMAIN уже задан в .env — оставляю как есть"
    fi
fi
set -a; . ./.env; set +a

# CORS fail-closed: в production backend не стартует, если CORS_ORIGINS пуст
# (см. app/core/config.py). Ловим это здесь, а не в логах контейнера.
if [ -z "${CORS_ORIGINS:-}" ] && [ -z "${FRONTEND_URL:-}" ]; then
    echo "ОШИБКА: в .env пусты и CORS_ORIGINS, и FRONTEND_URL — backend не запустится."
    echo "         Впишите FRONTEND_URL=https://ваш-домен (или CORS_ORIGINS) и повторите."
    exit 1
fi

echo "==> Caddyfile (домен: ${DOMAIN:-нет, HTTP по IP})"
if [ -n "${DOMAIN:-}" ]; then
    if [ "${INCLUDE_WWW:-}" = "1" ]; then
        # {$DOMAIN} в шаблоне матчит только голый хост — для www нужен
        # отдельный адрес в той же директиве.
        sed "s/^{\$DOMAIN}/{\$DOMAIN}, www.{\$DOMAIN}/" deploy/Caddyfile.domain > deploy/Caddyfile
    else
        cp deploy/Caddyfile.domain deploy/Caddyfile
    fi
else
    cp deploy/Caddyfile.http deploy/Caddyfile
fi

echo "==> Сборка образов"
docker compose -f docker-compose.prod.yml build

echo "==> Запуск БД"
# Postgres поднимаем первым: миграции идут отдельным контейнером и должны
# видеть хост `postgres` в сети compose — до `up -d` сети ещё нет.
docker compose -f docker-compose.prod.yml up -d postgres
for i in $(seq 1 60); do
    if docker compose -f docker-compose.prod.yml exec -T postgres \
        pg_isready -U "${POSTGRES_USER:-marketplace}" -d "${POSTGRES_DB:-marketplace_db}" >/dev/null 2>&1; then
        break
    fi
    [ "$i" = 60 ] && { echo "postgres не поднялся, логи:"; docker compose -f docker-compose.prod.yml logs --tail 50 postgres; exit 1; }
    sleep 2
done
echo "    postgres готов"

echo "==> Миграции БД"
# main.py создаёт таблицы только при ENV=development; в production схему
# накатывает Alembic. До этой правки миграции запускались ДО `up -d`, то есть
# до появления сети compose — контейнер не резолвил хост `postgres` и падал.
if docker compose -f docker-compose.prod.yml run --rm --no-deps backend alembic upgrade head; then
    echo "    миграции применены"
else
    echo "    ВНИМАНИЕ: alembic не отработал. Если база пустая, приложение"
    echo "    поднимется без таблиц. Проверьте backend/migrations и повторите:"
    echo "      docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head"
    read -rp "    Продолжить запуск всё равно? [y/N]: " GO
    [ "${GO:-n}" = "y" ] || exit 1
fi

echo "==> Запуск стека"
docker compose -f docker-compose.prod.yml up -d

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
    # Пароль демо-аккаунтов не хардкодится: seed_demo.py берёт DEMO_PASSWORD
    # из окружения либо генерирует случайный. Не печатаем его в лог деплоя.
    docker compose -f docker-compose.prod.yml exec -T backend python seed_demo.py
    echo "    Демо-данные созданы."
    echo "    Пароль — значение DEMO_PASSWORD (задайте его в .env перед запуском),"
    echo "    иначе он в backend/demo_password.txt внутри контейнера:"
    echo "      docker compose -f docker-compose.prod.yml exec backend cat demo_password.txt"
    echo "    ВНИМАНИЕ: демо-данные в проде создают админа — не оставляйте это без присмотра."
fi

if [ -n "${DOMAIN:-}" ]; then
    echo ""
    echo "==> Проверка домена $DOMAIN"
    # Caddy выпускает сертификат через несколько секунд после старта — ждём
    # и проверяем именно HTTPS, а не факт запуска контейнера.
    OK=0
    for i in $(seq 1 30); do
        if curl -fsS -o /dev/null --max-time 10 "https://$DOMAIN/health" 2>/dev/null; then
            OK=1; break
        fi
        sleep 3
    done
    if [ "$OK" = "1" ]; then
        echo "    https://$DOMAIN отвечает, сертификат выпущен"
    else
        echo "    ВНИМАНИЕ: https://$DOMAIN не ответил за 90 секунд."
        echo "    Логи Caddy:" 
        docker compose -f docker-compose.prod.yml logs --tail 30 caddy 2>/dev/null || true
        echo ""
        echo "    Частые причины: юникод в DOMAIN вместо punycode (см."
        echo "    deploy/Caddyfile.domain), порт 443 занят старым nginx,"
        echo "    A-запись ещё не разошлась."
    fi
fi

echo ""
echo "=========================================="
echo " Готово: $FRONTEND_URL"
echo " Логи:   docker compose -f docker-compose.prod.yml logs -f backend"
echo " Апдейт: git pull && docker compose -f docker-compose.prod.yml up -d --build"
echo "=========================================="
