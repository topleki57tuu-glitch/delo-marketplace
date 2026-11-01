#!/usr/bin/env bash
# ============================================================================
# Мониторинг «ДЕЛО»: сайт, контейнеры, диск, сертификат, резервные копии.
#
#   bash scripts/monitor.sh            проверить всё сейчас и показать итог
#   bash scripts/monitor.sh --setup    подключить уведомления в Telegram
#   bash scripts/monitor.sh --test     отправить пробное уведомление
#
# По расписанию (каждые 5 минут; включает scripts/backup.sh --install)
# запускается с --cron: при появлении проблемы присылает уведомление,
# пока она не решена — напоминает раз в 6 часов, решилась — сообщает.
#
# Что проверяется:
#   сайт        https://ДОМЕН/health/db через Caddy: сертификат, nginx,
#               backend и база разом. Уведомление — после двух неудач подряд
#               (10 минут), чтобы не будить из-за перезапуска.
#   контейнеры  postgres, redis, backend, worker, beat, frontend, caddy и bot
#               (если задан TELEGRAM_BOT_TOKEN). Воркер и планировщик падают
#               незаметно для сайта, а без них не идут фоновые задачи.
#   диск        занято 90% и больше
#   сертификат  до окончания меньше 14 дней. Caddy продлевает его за 30 дней,
#               так что это значит: продление сломалось.
#   копии       последней ночной копии больше 26 часов (если копии включены)
#
# Пока идёт обновление или восстановление (vps_update.sh, restore.sh),
# проверки по расписанию пропускаются.
#
# Этот мониторинг работает на самом сервере: если сервер выключится целиком,
# он промолчит. На этот случай нужна внешняя проверка — UPDATE_GUIDE.md,
# раздел «Мониторинг».
#
# Пороги в .env (необязательно): MONITOR_DISK_PERCENT=90 MONITOR_CERT_DAYS=14
# MONITOR_BACKUP_HOURS=26; MONITOR_HEALTH_URL — свой адрес проверки сайта.
# ============================================================================
set -uo pipefail

# shellcheck source=scripts/ops_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/ops_common.sh"
cd "$APP_DIR" || exit 1

MODE=status
case "${1:-}" in
    "" | --status) ;;
    --cron) MODE=cron ;;
    --setup) MODE=setup ;;
    --test) MODE="test" ;;
    -h | --help) sed -n '3,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "неизвестный аргумент: $1 (справка: bash scripts/monitor.sh --help)" ;;
esac

MONITOR_STATE="$STATE_DIR/monitor"
REMIND_SECONDS=$((6 * 3600))

DOMAIN="$(env_get DOMAIN)"
SITE_NAME="$(domain_display "$DOMAIN")"
HEALTH_URL="$(env_get MONITOR_HEALTH_URL)"
DISK_LIMIT="$(env_get MONITOR_DISK_PERCENT 90)"
CERT_DAYS="$(env_get MONITOR_CERT_DAYS 14)"
BACKUP_MAX_HOURS="$(env_get MONITOR_BACKUP_HOURS 26)"

# Каждая проверка кладёт сюда текст: что не так, или что в порядке.
# Код возврата: 0 — в порядке, 1 — проблема, 2 — проверить нельзя или
# не нужно (состояние не меняется).
MSG=""

duration() {
    local s="$1"
    if [ "$s" -lt 3600 ]; then
        echo "$(( (s + 59) / 60 )) мин"
    elif [ "$s" -lt 172800 ]; then
        echo "$((s / 3600)) ч $(( (s % 3600) / 60 )) мин"
    else
        echo "$((s / 86400)) дн."
    fi
}

check_site() {
    local url shown out err code secs hint
    local -a extra=()
    if [ -n "$HEALTH_URL" ]; then
        url="$HEALTH_URL"
        shown="$url"
    elif [ -n "$DOMAIN" ]; then
        # Через Caddy на этом же сервере, но с настоящим именем: проверяются
        # и сертификат, и вся цепочка. DNS не участвует — его проверит
        # внешний мониторинг.
        url="https://$DOMAIN/health/db"
        shown="https://$SITE_NAME/health/db"
        extra=(--resolve "$DOMAIN:443:127.0.0.1")
    else
        url="http://127.0.0.1/health/db"
        shown="$url"
    fi
    err="$(mktemp)"
    out="$(curl -sS -o /dev/null -m 20 -w '%{http_code} %{time_total}' "${extra[@]}" "$url" 2> "$err")"
    code="${out%% *}"
    secs="$(awk -v s="${out##* }" 'BEGIN { printf "%.2f", s }')"
    if [ "$code" = "200" ]; then
        MSG="$shown — ответ за ${secs} с"
        rm -f "$err"
        return 0
    fi
    case "$code" in
        502 | 504) hint=" (backend не отвечает)" ;;
        503) hint=" (нет связи с базой или backend перегружен)" ;;
        000 | "") hint=": $(sed 's/^curl: ([0-9]*) //' "$err" | head -n 1)" ;;
        *) hint="" ;;
    esac
    [ "$code" = "000" ] || [ -z "$code" ] || hint=" — HTTP $code$hint"
    rm -f "$err"
    MSG="Сайт не отвечает: $shown$hint"
    return 1
}

check_containers() {
    local names=(postgres redis backend worker beat frontend caddy) n info status health code bad=""
    [ -n "$(env_get TELEGRAM_BOT_TOKEN)" ] && names+=(bot)
    if ! command -v docker > /dev/null 2>&1; then
        MSG="docker не найден"
        return 2
    fi
    for n in "${names[@]}"; do
        if ! info="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}' "marketplace_$n" 2> /dev/null)"; then
            bad+="${bad:+, }$n (нет контейнера)"
            continue
        fi
        IFS='|' read -r status health code <<< "$info"
        if [ "$status" != "running" ]; then
            bad+="${bad:+, }$n ($status$([ "$status" = "exited" ] && echo ", код $code"))"
        elif [ "$health" = "unhealthy" ]; then
            bad+="${bad:+, }$n (unhealthy)"
        fi
    done
    if [ -n "$bad" ]; then
        MSG="Не работают контейнеры: $bad. Журнал: docker logs --tail 50 marketplace_ИМЯ"
        return 1
    fi
    MSG="${names[*]} — работают"
    return 0
}

check_disk() {
    local paths=(/) p line fs used avail mount pct seen=" " bad="" ok=""
    [ -d /var/lib/docker ] && paths+=(/var/lib/docker)
    [ -d "$BACKUP_DIR" ] && paths+=("$BACKUP_DIR")
    for p in "${paths[@]}"; do
        line="$(df -PB1 "$p" 2> /dev/null | awk 'NR == 2 { print $1, $2, $3, $4, $6 }')"
        [ -n "$line" ] || continue
        read -r fs _ used avail mount <<< "$line"
        case "$seen" in *" $fs "*) continue ;; esac
        seen+="$fs "
        # Как Use% у df: от места, доступного не только root.
        [ $((used + avail)) -gt 0 ] || continue
        pct=$(( (used * 100 + used + avail - 1) / (used + avail) ))
        if [ "$pct" -ge "$DISK_LIMIT" ]; then
            bad+="${bad:+; }$mount занят на $pct%, свободно $(human_size "$avail")"
        else
            ok+="${ok:+; }$mount занят на $pct%, свободно $(human_size "$avail")"
        fi
    done
    if [ -n "$bad" ]; then
        MSG="Заканчивается место на диске: $bad. Освободить: docker system prune -f; старые копии — $BACKUP_DIR"
        return 1
    fi
    MSG="${ok:-нет данных df}"
    return 0
}

check_cert() {
    local end end_ts days
    [ -n "$DOMAIN" ] || { MSG="домен не задан — HTTPS не используется"; return 2; }
    [ -z "$HEALTH_URL" ] || { MSG="задан MONITOR_HEALTH_URL — не проверяется"; return 2; }
    command -v openssl > /dev/null 2>&1 || { MSG="нет openssl"; return 2; }
    end="$(echo | timeout 20 openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2> /dev/null \
        | openssl x509 -noout -enddate 2> /dev/null | cut -d= -f2)"
    # Сертификат не получен — значит, недоступен сам сайт, об этом скажет
    # проверка сайта. Второе уведомление о том же не нужно.
    [ -n "$end" ] || { MSG="сертификат не получен (см. проверку сайта)"; return 2; }
    end_ts="$(date -d "$end" +%s 2> /dev/null)" || { MSG="не разобрать дату: $end"; return 2; }
    days=$(( (end_ts - $(date +%s)) / 86400 ))
    if [ "$days" -lt "$CERT_DAYS" ]; then
        MSG="Сертификат $SITE_NAME истекает через $days дн. ($(date -d "@$end_ts" '+%d.%m.%Y')): Caddy его не продлил. Журнал: docker logs --tail 100 marketplace_caddy"
        return 1
    fi
    MSG="действует до $(date -d "@$end_ts" '+%d.%m.%Y') ($days дн.)"
    return 0
}

# Последняя готовая ночная копия (полная, без метки) — имя каталога.
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

check_backups() {
    local name age since_install
    if ! grep -qs 'backup.sh' "$CRON_FILE"; then
        MSG="по расписанию не делаются — включить: bash scripts/backup.sh --install"
        return 2
    fi
    name="$(latest_full_backup)"
    if [ -z "$name" ]; then
        since_install=$(( $(date +%s) - $(stat -c %Y "$CRON_FILE") ))
        if [ "$since_install" -gt $((BACKUP_MAX_HOURS * 3600)) ]; then
            MSG="Нет ни одной готовой резервной копии, хотя расписание включено $(duration "$since_install") назад. Журнал: $LOG_DIR/delo-backup.log"
            return 1
        fi
        MSG="готовых копий пока нет (расписание включено недавно)"
        return 2
    fi
    age=$(( $(date +%s) - $(stat -c %Y "$BACKUP_DIR/$name/OK") ))
    if [ "$age" -gt $((BACKUP_MAX_HOURS * 3600)) ]; then
        MSG="Резервные копии не обновляются: последняя готовая — $name, $(duration "$age") назад. Журнал: $LOG_DIR/delo-backup.log"
        return 1
    fi
    MSG="последняя — $name ($(duration "$age") назад)"
    return 0
}

CHECKS="site containers disk cert backups"

title() {
    case "$1" in
        site) echo "сайт" ;;
        containers) echo "контейнеры" ;;
        disk) echo "диск" ;;
        cert) echo "сертификат" ;;
        backups) echo "копии" ;;
    esac
}

# Для таблицы --status: printf выравнивает по байтам, а не по буквам.
title_padded() {
    case "$1" in
        site) echo "сайт       " ;;
        containers) echo "контейнеры " ;;
        disk) echo "диск       " ;;
        cert) echo "сертификат " ;;
        backups) echo "копии      " ;;
    esac
}

# Сколько неудач подряд нужно для уведомления.
threshold() {
    case "$1" in
        site | containers) echo 2 ;;
        *) echo 1 ;;
    esac
}

# Уведомление. Не настроен Telegram — остаётся строкой в журнале, и это
# считается доставкой (повторять бессмысленно). Настроен, но не дошло —
# повтор при следующем запуске.
notify() {
    if ! alert_configured; then
        log "[Telegram не настроен: bash scripts/monitor.sh --setup] $1"
        return 0
    fi
    if send_alert "$1"; then
        log "отправлено: $1"
        return 0
    fi
    return 1
}

# Состояние проверки — файл: «неудач_подряд с_какого_времени когда_уведомили»
# и текст последней проблемы. Нет файла — всё в порядке.
evaluate() {
    local name="$1" rc="$2" text="$3" file fails=0 since=0 alerted=0 now
    file="$MONITOR_STATE/$name"
    now="$(date +%s)"
    [ "$rc" = "2" ] && return 0
    if [ -f "$file" ]; then
        read -r fails since alerted < "$file" || true
    fi
    if [ "$rc" = "0" ]; then
        if [ -f "$file" ] && [ "${alerted:-0}" != "0" ]; then
            notify "✅ Снова в порядке — $(title "$name"): $text. Проблема длилась $(duration $((now - since)))." || return 0
        fi
        rm -f "$file"
        return 0
    fi
    fails=$((fails + 1))
    [ "${since:-0}" != "0" ] || since="$now"
    if [ "${alerted:-0}" = "0" ]; then
        if [ "$fails" -ge "$(threshold "$name")" ] && notify "❗ $text"; then
            alerted="$now"
        fi
    elif [ $((now - alerted)) -ge "$REMIND_SECONDS" ]; then
        notify "❗ Всё ещё не решено (с $(date -d "@$since" '+%d.%m %H:%M')): $text" && alerted="$now"
    fi
    printf '%s %s %s\n%s\n' "$fails" "$since" "${alerted:-0}" "$text" > "$file"
}

run_cron() {
    mkdir -p "$MONITOR_STATE"
    exec 8> "$MONITOR_STATE/.lock"
    # Прошлая проверка ещё идёт (зависла сеть) — эту пропускаем.
    flock -n 8 || exit 0
    date +%s > "$MONITOR_STATE/last_run"
    maintenance_active && exit 0
    local c rc
    for c in $CHECKS; do
        MSG=""
        "check_$c"
        rc=$?
        evaluate "$c" "$rc" "$MSG"
    done
}

run_status() {
    local c rc problems=0 mark last
    echo "Мониторинг «ДЕЛО» — $(date '+%d.%m.%Y %H:%M %Z')"
    if maintenance_active; then
        echo "  идёт обслуживание: $(cat "$STATE_DIR/maintenance")"
    fi
    for c in $CHECKS; do
        MSG=""
        "check_$c"
        rc=$?
        case "$rc" in
            0) mark="✓" ;;
            1) mark="✗"; problems=$((problems + 1)) ;;
            *) mark="·" ;;
        esac
        printf '  %s %s %s\n' "$mark" "$(title_padded "$c")" "$MSG"
    done
    echo ""
    if alert_configured; then
        echo "Уведомления: Telegram, чат $(env_get ALERT_TELEGRAM_CHAT_ID). Проверить: bash scripts/monitor.sh --test"
    else
        echo "Уведомления: не настроены — bash scripts/monitor.sh --setup"
    fi
    if grep -qs 'monitor.sh' "$CRON_FILE"; then
        last="$(cat "$MONITOR_STATE/last_run" 2> /dev/null || true)"
        if [ -n "$last" ]; then
            echo "По расписанию: каждые 5 минут, последний раз $(duration $(( $(date +%s) - last ))) назад"
        else
            echo "По расписанию: каждые 5 минут (ещё не запускался — проверьте службу cron)"
        fi
    else
        echo "По расписанию: не включено — bash scripts/backup.sh --install"
    fi
    [ "$problems" -eq 0 ]
}

# --- Настройка уведомлений ---------------------------------------------------

tg_call() {
    # tg_call ТОКЕН МЕТОД [аргументы curl] — ответ Bot API в stdout.
    local token="$1" method="$2" api
    shift 2
    api="${TELEGRAM_API_URL:-$(env_get TELEGRAM_API_URL https://api.telegram.org)}"
    printf 'url = "%s/bot%s/%s"\n' "$api" "$token" "$method" | curl -sS -m 20 -K - "$@" 2> /dev/null
}

json_field() {
    # Первое строковое или числовое значение ключа — без jq и python.
    grep -oE "\"$1\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|-?[0-9]+)" | head -n 1 \
        | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*//' | tr -d '"'
}

run_setup() {
    local token="" service_token answer me bot chat updates
    [ -f "$APP_DIR/.env" ] || die "нет $APP_DIR/.env — сначала scripts/vps_deploy.sh"
    [ -w "$APP_DIR/.env" ] || die "нет прав на запись $APP_DIR/.env — запускайте от root"
    echo "Уведомления о сбоях придут в Telegram от бота."
    echo ""
    service_token="$(env_get TELEGRAM_BOT_TOKEN)"
    token="$(env_get ALERT_TELEGRAM_BOT_TOKEN)"
    if [ -n "$token" ]; then
        read -rp "Бот для уведомлений уже задан. Заменить его? [y/N]: " answer
        [ "${answer:-n}" = "y" ] && token=""
    fi
    if [ -z "$token" ]; then
        echo "Создайте отдельного бота: в Telegram откройте @BotFather, команда"
        echo "/newbot, придумайте имя — BotFather пришлёт токен вида 123456:ABC..."
        [ -n "$service_token" ] && echo "(Enter без токена — уведомления будет присылать бот сайта.)"
        read -rsp "Токен бота (ввод скрыт): " token
        echo ""
        token="$(printf '%s' "$token" | tr -d '[:space:]')"
    fi
    if [ -z "$token" ]; then
        [ -n "$service_token" ] || die "токен не введён"
        token="$service_token"
    fi

    me="$(tg_call "$token" getMe)"
    if ! printf '%s' "$me" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
        die "Telegram не принял токен: $(printf '%s' "$me" | json_field description)"
    fi
    bot="$(printf '%s' "$me" | json_field username)"
    echo "Бот: @$bot"
    # Пустое значение — значит, бот сайта (см. alert_token в ops_common.sh).
    if [ "$token" = "$service_token" ]; then
        env_set ALERT_TELEGRAM_BOT_TOKEN ""
    else
        env_set ALERT_TELEGRAM_BOT_TOKEN "$token"
    fi

    chat=""
    if [ "$token" != "$service_token" ]; then
        # Отдельного бота никто не опрашивает — можно спросить у Telegram,
        # кто ему написал. У бота сайта так нельзя: getUpdates отнял бы
        # сообщения у работающего бота.
        echo ""
        echo "Откройте в Telegram https://t.me/$bot, нажмите «Начать» (Start)"
        read -rp "и затем нажмите здесь Enter... " answer
        updates="$(tg_call "$token" getUpdates)"
        chat="$(printf '%s' "$updates" | grep -oE '"chat"[[:space:]]*:[[:space:]]*\{[[:space:]]*"id"[[:space:]]*:[[:space:]]*-?[0-9]+' \
            | tail -n 1 | grep -oE -- '-?[0-9]+$' || true)"
        [ -n "$chat" ] && echo "Чат найден: $chat"
    else
        echo ""
        echo "Нажмите «Начать» (Start) у бота https://t.me/$bot — иначе он не сможет"
        echo "вам писать."
    fi
    if [ -z "$chat" ]; then
        echo "Узнайте свой числовой id: напишите боту @userinfobot — он ответит"
        echo "строкой Id: 123456789. Для группы: добавьте бота в группу, id группы"
        echo "начинается с минуса."
        read -rp "Id чата: " chat
        chat="$(printf '%s' "$chat" | tr -d '[:space:]')"
    fi
    [[ "$chat" =~ ^-?[0-9]+$ ]] || die "id чата — это число, получено: '$chat'"
    env_set ALERT_TELEGRAM_CHAT_ID "$chat"

    if send_alert "Уведомления подключены. Сюда придёт сообщение, если сайт перестанет отвечать, закончится место, не создастся резервная копия или откажет сертификат."; then
        echo "Готово: пробное сообщение отправлено — проверьте Telegram."
    else
        die "сообщение не доставлено. Бот должен быть запущен вами (кнопка «Начать»), id — ваш. Повторите: bash scripts/monitor.sh --setup"
    fi
    if ! grep -qs 'monitor.sh' "$CRON_FILE"; then
        echo ""
        echo "Проверки по расписанию ещё не включены: bash scripts/backup.sh --install"
        echo "(заодно включит ночные резервные копии)."
    fi
}

case "$MODE" in
    cron) run_cron ;;
    status) run_status ;;
    test)
        alert_configured || die "Telegram не настроен: bash scripts/monitor.sh --setup"
        if send_alert "Проверка уведомлений: если вы это читаете, всё работает."; then
            echo "Отправлено — проверьте Telegram."
        else
            die "не доставлено (подробности выше)"
        fi
        ;;
    setup) run_setup ;;
esac
