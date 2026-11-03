# shellcheck shell=bash
# ============================================================================
# Общие функции скриптов обслуживания VPS: backup.sh, restore.sh, monitor.sh,
# offsite.sh, vps_update.sh. Подключается через `. scripts/ops_common.sh` и
# сам по себе ничего не делает.
#
# Переопределяемые переменные окружения (для проверки на стенде и особых
# установок; на VPS ничего задавать не нужно):
#   APP_DIR       каталог приложения (по умолчанию — корень репозитория)
#   BACKUP_DIR    куда складывать копии       (/var/backups/delo)
#   STATE_DIR     состояние мониторинга и т.п. (/var/lib/delo)
#   CRON_FILE     файл расписания             (/etc/cron.d/delo-marketplace)
#   LOGROTATE_FILE                            (/etc/logrotate.d/delo-marketplace)
#   LOG_DIR       журналы cron-задач          (/var/log)
#   TELEGRAM_API_URL  адрес Bot API           (https://api.telegram.org)
# ============================================================================

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# Без кавычек при вызове: это команда с аргументами.
COMPOSE="docker compose -f docker-compose.prod.yml"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
# FAIL_REASON читают обработчики выхода (backup.sh — для уведомления).
# shellcheck disable=SC2034
die() { FAIL_REASON="$*"; log "ОШИБКА: $*" >&2; exit 1; }

# Значение ключа из .env. Файл не исполняем через `source`: в .env бывают
# значения с пробелами и `$`, и `set -u` уронил бы скрипт на любой из них.
# Последнее вхождение побеждает — как у docker compose. DELO_ENV_FILE —
# прочитать другой файл того же вида (копию .env из резервной копии).
env_get() {
    local key="$1" default="${2:-}" line
    line="$(grep -E "^[[:space:]]*${key}=" "${DELO_ENV_FILE:-$APP_DIR/.env}" 2>/dev/null | tail -n 1 || true)"
    if [ -z "$line" ]; then
        printf '%s' "$default"
        return 0
    fi
    line="${line#*=}"
    line="${line%$'\r'}"
    case "$line" in
        \"*\") line="${line#\"}"; line="${line%\"}" ;;
        \'*\') line="${line#\'}"; line="${line%\'}" ;;
    esac
    [ -n "$line" ] || line="$default"
    printf '%s' "$line"
}

# Дописать или заменить ключ в .env (права файла не меняются).
env_set() {
    local key="$1" value="$2" file="$APP_DIR/.env" tmp
    [ -f "$file" ] || die "нет $file"
    tmp="$(mktemp "$file.XXXXXX")"
    grep -vE "^[[:space:]]*${key}=" "$file" > "$tmp" || true
    # Перевод строки в конце — иначе ключ приклеится к последней строке.
    if [ -s "$tmp" ] && [ -n "$(tail -c 1 "$tmp")" ]; then echo "" >> "$tmp"; fi
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    chmod --reference="$file" "$tmp" 2>/dev/null || chmod 600 "$tmp"
    mv "$tmp" "$file"
}

# Каталоги: переменная окружения > значение из .env > по умолчанию.
BACKUP_DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR /var/backups/delo)}"
STATE_DIR="${STATE_DIR:-/var/lib/delo}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/delo-marketplace}"
LOGROTATE_FILE="${LOGROTATE_FILE:-/etc/logrotate.d/delo-marketplace}"
LOG_DIR="${LOG_DIR:-/var/log}"

pg_user() { env_get POSTGRES_USER marketplace; }
pg_db() { env_get POSTGRES_DB marketplace_db; }

# psql внутри контейнера postgres. Пароль не нужен: в официальном образе
# подключение через локальный сокет доверенное, а наружу порт не открыт.
pg_psql() {
    $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -X -q -U "$(pg_user)" "$@"
}

# Одно значение запросом к базе приложения (или к указанной через -d).
pg_value() {
    local db="$1" sql="$2"
    pg_psql -d "$db" -tAc "$sql"
}

postgres_running() {
    [ -n "$($COMPOSE ps -q --status running postgres 2>/dev/null)" ]
}

# Ревизия схемы в базе (таблица alembic_version); пусто — если таблицы нет.
db_revision() {
    pg_value "${1:-$(pg_db)}" "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true
}

# Есть ли миграция с такой ревизией в текущем коде.
revision_in_code() {
    local rev="$1"
    [ -n "$rev" ] || return 1
    grep -lqE "^revision(:[^=]*)?=[[:space:]]*['\"]${rev}['\"]" "$APP_DIR"/backend/migrations/versions/*.py 2>/dev/null
}

# Ожидание, пока backend ответит на /health изнутри своего контейнера.
wait_backend() {
    local tries="${1:-60}" _
    for _ in $(seq 1 "$tries"); do
        if $COMPOSE exec -T backend python -c \
            "import urllib.request;urllib.request.urlopen('http://localhost:8000/health', timeout=5)" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

# Домен для людей: xn--d1acsm.online -> дело.online (в .env он в punycode,
# см. deploy/Caddyfile.domain). Без python3 — как есть.
domain_display() {
    local d="${1-}"
    case "$d" in
        *xn--*)
            if command -v python3 >/dev/null 2>&1 && \
                python3 -c 'import sys; print(sys.argv[1].encode().decode("idna"))' "$d" 2>/dev/null; then
                return 0
            fi
            ;;
    esac
    printf '%s\n' "$d"
}

human_size() {
    local bytes="${1:-0}"
    awk -v b="$bytes" 'BEGIN { split("Б КБ МБ ГБ ТБ", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } printf (i == 1 ? "%d %s" : "%.1f %s"), b, u[i] }'
}

# Свободное место (байты) на разделе, где лежит каталог.
free_bytes() {
    df -PB1 "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# --- Копии -------------------------------------------------------------------

# Последняя готовая полная копия без метки — ночная или сделанная вручную
# (имя каталога в BACKUP_DIR). Имя начинается с даты: сортировка по имени —
# это сортировка по времени.
latest_full_backup() {
    local d n
    [ -d "$BACKUP_DIR" ] || return 0
    for d in "$BACKUP_DIR"/*/; do
        n="$(basename "$d")"
        [[ "$n" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$ ]] || continue
        [ -f "$d/OK" ] || continue
        grep -qx 'kind=full' "$d/manifest.txt" 2> /dev/null || continue
        echo "$n"
    done | sort | tail -n 1
}

# Выгрузка копий в облачное хранилище настроена (scripts/offsite.sh --setup).
offsite_configured() {
    [ -n "$(env_get BACKUP_S3_BUCKET)" ] && [ -n "$(env_get BACKUP_S3_ENDPOINT)" ]
}

# Идёт обновление или восстановление (флаг ставят vps_update.sh и
# restore.sh). Флаг старше часа считается забытым: скрипт убили или сервер
# перезагрузился посреди обновления.
maintenance_active() {
    local f="$STATE_DIR/maintenance"
    [ -f "$f" ] || return 1
    [ $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 3600 ]
}

# --- Уведомления в Telegram --------------------------------------------------
# Бот — ALERT_TELEGRAM_BOT_TOKEN или, если его нет, бот сервиса
# (TELEGRAM_BOT_TOKEN); чат — ALERT_TELEGRAM_CHAT_ID. Настройка:
# bash scripts/monitor.sh --setup. Не настроено — сообщение остаётся в журнале.
#
# Токен не попадает в командную строку (её видят все пользователи сервера
# через ps): curl читает адрес из stdin (-K -).
alert_configured() {
    [ -n "$(alert_token)" ] && [ -n "$(env_get ALERT_TELEGRAM_CHAT_ID)" ]
}

alert_token() {
    local token
    token="$(env_get ALERT_TELEGRAM_BOT_TOKEN)"
    [ -n "$token" ] || token="$(env_get TELEGRAM_BOT_TOKEN)"
    printf '%s' "$token"
}

send_alert() {
    local text="$1" token chat api host code
    token="$(alert_token)"
    chat="$(env_get ALERT_TELEGRAM_CHAT_ID)"
    api="${TELEGRAM_API_URL:-$(env_get TELEGRAM_API_URL https://api.telegram.org)}"
    host="$(domain_display "$(env_get DOMAIN)")"
    [ -n "$host" ] || host="$(hostname 2>/dev/null || echo server)"
    if [ -z "$token" ] || [ -z "$chat" ]; then
        log "[уведомление не отправлено — Telegram не настроен: bash scripts/monitor.sh --setup] $text"
        return 1
    fi
    code="$(printf 'url = "%s/bot%s/sendMessage"\n' "$api" "$token" | curl -sS -m 20 -o /dev/null -w '%{http_code}' -K - \
        --data-urlencode "chat_id=$chat" \
        --data-urlencode "text=[ДЕЛО · $host] $text" \
        --data-urlencode "disable_web_page_preview=true" 2>/dev/null || true)"
    if [ "$code" != "200" ]; then
        log "[уведомление не доставлено, Telegram ответил ${code:-ошибкой сети}] $text"
        return 1
    fi
    return 0
}

# --- Расписание (cron) и ротация журналов ------------------------------------
cron_installed() { [ -f "$CRON_FILE" ]; }

install_cron() {
    mkdir -p "$(dirname "$CRON_FILE")" "$LOG_DIR"
    cat > "$CRON_FILE" <<CRON
# «ДЕЛО»: резервные копии и мониторинг. Создано scripts/backup.sh --install,
# повторный запуск перезаписывает файл. Время — часовой пояс сервера.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Каждую ночь: копия базы, файлов и .env с проверкой восстановлением
30 0 * * * root bash $APP_DIR/scripts/backup.sh --cron >> $LOG_DIR/delo-backup.log 2>&1
# Каждые 5 минут: сайт, диск, сертификат, контейнеры, свежесть копий
*/5 * * * * root bash $APP_DIR/scripts/monitor.sh --cron >> $LOG_DIR/delo-monitor.log 2>&1
CRON
    chmod 644 "$CRON_FILE"
    if [ -d "$(dirname "$LOGROTATE_FILE")" ]; then
        cat > "$LOGROTATE_FILE" <<ROTATE
$LOG_DIR/delo-backup.log $LOG_DIR/delo-monitor.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
ROTATE
        chmod 644 "$LOGROTATE_FILE"
    fi
}
