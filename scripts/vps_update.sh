#!/usr/bin/env bash
# ============================================================================
# Обновление уже развёрнутого маркетплейса «ДЕЛО» на VPS — и откат.
#
#   bash scripts/vps_update.sh              обновить до последней версии
#   bash scripts/vps_update.sh --rollback   вернуть версию, которая работала
#                                           до последнего обновления
#   bash scripts/vps_update.sh КОММИТ       перейти на конкретную версию
#   bash scripts/vps_update.sh --history    журнал обновлений
#
# Отличия от vps_deploy.sh: тот скрипт для ПЕРВОЙ установки — он перезаписывает
# .env, генерирует секреты и ставит Docker. Этот только подтягивает код,
# накатывает миграции и пересобирает образы. Существующий .env не трогается.
#
# Главное, зачем он нужен: `up -d --build` без миграций. Если в обновлении есть
# новая миграция, схема БД не обновится, и приложение упадёт на отсутствующей
# колонке. Здесь alembic вызывается всегда.
#
# Шаги и что будет, если шаг не удался:
#   1. копия базы (метка pre-update-…)  -> обновление отменено, ничего не тронуто
#   2. код и сборка образов             -> код возвращается; сайт всё это время
#                                          работает на прежних контейнерах
#   3. миграции БД                      -> код и образы возвращаются (миграции
#                                          идут одной транзакцией и откатываются)
#   4. перезапуск и проверка /health    -> прежняя версия возвращается сама
#                                          (в терминале — после вопроса)
# Каждая попытка пишется в журнал (/var/lib/delo/deploy-history); --rollback
# берёт из него последнюю версию, обновившуюся успешно, кроме текущей, и
# проходит те же шаги. Повторный --rollback вернёт обратно.
#
# Откат кода не откатывает схему базы. Если новая версия добавила миграцию,
# старая версия запустится на новой схеме (обычно это работает: миграции
# добавляют, а не удаляют); если нет — скрипт подскажет копию базы,
# снятую перед обновлением, и команду restore.sh.
#
# SKIP_BACKUP=1 bash scripts/vps_update.sh — без копии базы перед обновлением.
# ============================================================================
set -Eeuo pipefail

# shellcheck source=scripts/ops_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/ops_common.sh"
cd "$APP_DIR"

HISTORY_FILE="$STATE_DIR/deploy-history"
MAINT_FILE="$STATE_DIR/maintenance"

usage() { sed -n '3,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

short() { git rev-parse --short=7 "$1" 2>/dev/null || printf '%.7s' "$1"; }
subject() { git log -1 --format=%s "$1" 2>/dev/null | tr -d '\n' || true; }

history_add() {
    mkdir -p "$STATE_DIR"
    printf '%s %s %s %s\n' "$(date -Iseconds)" "$(git rev-parse "$1")" "$2" "$(subject "$1")" >> "$HISTORY_FILE"
}

show_history() {
    local head
    head="$(git rev-parse HEAD)"
    if [ ! -s "$HISTORY_FILE" ]; then
        echo "Журнал пуст: он ведётся с первого обновления этим скриптом."
    else
        echo "Последние обновления (новые внизу):"
        tail -n 20 "$HISTORY_FILE" | while read -r when sha status subj; do
            printf '  %s  %s  %s %s\n' "$(date -d "$when" '+%d.%m.%Y %H:%M' 2>/dev/null || echo "$when")" \
                "${sha:0:7}" "$([ "$status" = ok ] && echo "ок  " || echo "СБОЙ")" "$subj"
        done
    fi
    echo ""
    echo "Сейчас: $(short "$head") $(subject "$head")"
    echo "Перейти на версию: bash scripts/vps_update.sh КОММИТ"
}

# Последняя успешно обновлённая версия, кроме текущей. Версия, которая
# работала, но при последней попытке не запустилась, не годится. В журнале
# ничего нет (до этого обновлялись старым скриптом) — по reflog git:
# последнее положение HEAD, отличное от текущего.
rollback_target() {
    local head="$1" sha="" bad=""
    if [ -s "$HISTORY_FILE" ]; then
        sha="$(awk -v h="$head" '
            { last[$2] = $3; sha[NR] = $2; st[NR] = $3 }
            END {
                for (i = NR; i > 0; i--)
                    if (st[i] == "ok" && sha[i] != h && last[sha[i]] == "ok") { print sha[i]; exit }
            }' "$HISTORY_FILE")"
        bad="$(awk '{ last[$2] = $3 } END { for (s in last) if (last[s] != "ok") printf " %s", s }' "$HISTORY_FILE")"
    fi
    if [ -n "$sha" ] && git cat-file -e "${sha}^{commit}" 2>/dev/null; then
        echo "$sha"
        return 0
    fi
    git reflog --format='%H' 2>/dev/null \
        | awk -v h="$head" -v bad="$bad " '$1 != h && index(bad, " " $1 " ") == 0 { print; exit }'
}

# Полный хеш по любому указанию версии. Клон на сервере сделан с --depth 1:
# старых коммитов в нём нет, их приходится догружать.
resolve_commit() {
    local ref="$1" sha
    if sha="$(git rev-parse -q --verify "${ref}^{commit}" 2>/dev/null)"; then
        echo "$sha"; return 0
    fi
    git fetch -q origin main 2>/dev/null || true
    if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
        log "    догружаю историю (клон был неполным)" >&2
        git fetch -q --unshallow origin 2>/dev/null || true
    fi
    if sha="$(git rev-parse -q --verify "${ref}^{commit}" 2>/dev/null)"; then
        echo "$sha"; return 0
    fi
    if git fetch -q origin "$ref" 2>/dev/null && sha="$(git rev-parse -q --verify "FETCH_HEAD^{commit}" 2>/dev/null)"; then
        echo "$sha"; return 0
    fi
    return 1
}

# confirm ВОПРОС [ответ-без-терминала] — без терминала (запуск из другого
# скрипта) вопрос не задаётся: по умолчанию «да».
confirm() {
    local answer
    if [ ! -t 0 ]; then
        [ "${2:-y}" = "y" ]
        return
    fi
    read -rp "$1 [Y/n]: " answer
    case "${answer:-y}" in y|Y|yes|д|Д|да) return 0 ;; *) return 1 ;; esac
}

# --- Аргументы ---------------------------------------------------------------
#
# Повторный запуск самого себя: если обновление принесло новую версию этого
# скрипта, текущий процесс после смены кода передаёт работу ей (exec), чтобы
# сборка и миграции шли по новым правилам. Состояние передаётся через
# DELO_UPDATE_* — новые версии скрипта обязаны их понимать.

if [ -n "${DELO_UPDATE_REEXEC:-}" ]; then
    MODE="${DELO_UPDATE_MODE:-update}"
    BEFORE="$DELO_UPDATE_BEFORE"
    TARGET="$DELO_UPDATE_TARGET"
    BACKUP_NAME="${DELO_UPDATE_BACKUP:-}"
    unset DELO_UPDATE_REEXEC DELO_UPDATE_MODE DELO_UPDATE_BEFORE DELO_UPDATE_TARGET DELO_UPDATE_BACKUP
    REEXEC=1
else
    REEXEC=0
    MODE=update
    ARG=""
    [ $# -le 1 ] || die "лишние аргументы: $* (справка: bash scripts/vps_update.sh --help)"
    case "${1:-}" in
        "") ;;
        --rollback) MODE=rollback ;;
        --history) show_history; exit 0 ;;
        -h|--help) usage; exit 0 ;;
        -*) die "неизвестный флаг: $1 (справка: bash scripts/vps_update.sh --help)" ;;
        *) MODE=commit; ARG="$1" ;;
    esac
fi

# Этот запуск — возврат прежней версии после того, как новая не запустилась
# (см. «Перезапуск»). Если не поднимется и прежняя, обратно на сломанную он
# не пойдёт — только подскажет, что делать.
REVERTING="${DELO_UPDATE_REVERTING:-}"
REVERT_BACKUP="${DELO_UPDATE_REVERT_BACKUP:-}"

[ -f .env ] || die "нет .env в $APP_DIR — сначала запустите scripts/vps_deploy.sh"

mkdir -p "$STATE_DIR"
if [ "$REEXEC" = "0" ]; then
    exec 7> "$STATE_DIR/update.lock"
    flock -n 7 || die "обновление уже идёт (в другом окне?)"
fi

STEP="подготовка"
SWITCHED=0
on_exit() {
    local code=$?
    rm -f "$MAINT_FILE"
    if [ "$code" -ne 0 ] && [ "$STEP" != "готово" ]; then
        echo "" >&2
        echo "Обновление прервано на шаге «$STEP»." >&2
        if [ "$SWITCHED" = "0" ]; then
            echo "Контейнеры не перезапускались: сайт работает на прежней версии." >&2
        fi
    fi
}
trap on_exit EXIT

# --- Выбор версии ------------------------------------------------------------

if [ "$REEXEC" = "0" ]; then
    BEFORE="$(git rev-parse HEAD)"
    BACKUP_NAME=""
    # До этого скрипта журнала не было; текущая версия на сайте работает —
    # запоминаем её, чтобы было куда откатиться после первого обновления.
    [ -s "$HISTORY_FILE" ] || history_add "$BEFORE" ok

    case "$MODE" in
        update)
            log "Получаю последнюю версию из GitHub"
            git fetch -q origin main || die "git fetch не удался — нет связи с GitHub?"
            TARGET="$(git rev-parse FETCH_HEAD)"
            ;;
        commit)
            TARGET="$(resolve_commit "$ARG")" \
                || die "версия «$ARG» не найдена ни на сервере, ни в GitHub (журнал: bash scripts/vps_update.sh --history)"
            ;;
        rollback)
            TARGET="$(rollback_target "$BEFORE")"
            [ -n "$TARGET" ] || die "не на что откатываться: в журнале нет другой успешной версии.
         Укажите версию явно: bash scripts/vps_update.sh КОММИТ"
            echo ""
            echo "  Сейчас:   $(short "$BEFORE") $(subject "$BEFORE")"
            echo "  Откат на: $(short "$TARGET") $(subject "$TARGET") ($(git log -1 --format=%cd --date=format:'%d.%m.%Y' "$TARGET"))"
            echo ""
            confirm "Откатить?" || die "отменено"
            ;;
    esac

    if [ "$TARGET" = "$BEFORE" ]; then
        log "Код не изменился ($(short "$BEFORE")) — пересобираю и перезапускаю как есть"
    else
        log "Версия: $(short "$BEFORE") -> $(short "$TARGET") «$(subject "$TARGET")»"
        if git merge-base --is-ancestor "$BEFORE" "$TARGET" 2>/dev/null; then
            git log --format='      %h %s' "$BEFORE..$TARGET" | head -n 15
        else
            echo "      (переход на более раннюю версию)"
        fi
    fi

    # Правки вручную на сервере `git reset --hard` затрёт — сохраняем их.
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        PATCH="$STATE_DIR/local-changes-$(date '+%Y%m%d_%H%M%S').patch"
        git diff HEAD > "$PATCH"
        log "ВНИМАНИЕ: файлы проекта на сервере правились вручную — правки будут заменены."
        log "    Сохранены в $PATCH (вернуть: git apply $PATCH)"
    fi

    echo "обновление $(short "$BEFORE") -> $(short "$TARGET")" > "$MAINT_FILE"

    STEP="копия базы"
    if [ "$TARGET" != "$BEFORE" ] && [ "${SKIP_BACKUP:-0}" != "1" ]; then
        if postgres_running; then
            log "Копия базы перед обновлением"
            TAG="pre-update-$(short "$BEFORE")"
            bash "$APP_DIR/scripts/backup.sh" --db-only --quick --tag "$TAG" 2>&1 | sed 's/^/    /' \
                || die "копия базы не удалась — обновление отменено, ничего не тронуто.
         Обновиться без копии: SKIP_BACKUP=1 bash scripts/vps_update.sh${ARG:+ $ARG}"
            BACKUP_NAME="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "*-$TAG" -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
        else
            log "ВНИМАНИЕ: postgres не запущен — копию базы перед обновлением снять не с чего"
        fi
    fi

    STEP="смена кода"
    git reset -q --hard "$TARGET"

    if [ "$TARGET" != "$BEFORE" ] \
        && ! git diff --quiet "$BEFORE" "$TARGET" -- scripts/vps_update.sh scripts/ops_common.sh \
        && grep -q 'DELO_UPDATE_REEXEC' scripts/vps_update.sh; then
        log "Скрипт обновления изменился — продолжаю его новой версией"
        export DELO_UPDATE_REEXEC=1 DELO_UPDATE_MODE="$MODE" DELO_UPDATE_BEFORE="$BEFORE" \
            DELO_UPDATE_TARGET="$TARGET" DELO_UPDATE_BACKUP="$BACKUP_NAME"
        trap - EXIT
        exec bash "$APP_DIR/scripts/vps_update.sh"
    fi
fi

echo "обновление $(short "$BEFORE") -> $(short "$TARGET")" > "$MAINT_FILE"

# Вернуть код и образы к BEFORE: сайт ещё работает на прежних контейнерах,
# но образы уже пересобраны с новым кодом, и любой следующий `up -d` поднял бы
# их на старой схеме базы. Пересборка прежней версии берёт слои из кэша.
revert_code() {
    history_add "$TARGET" failed
    [ "$TARGET" != "$BEFORE" ] || return 0
    log "Возвращаю код $(short "$BEFORE") и его образы (сборка из кэша)"
    git reset -q --hard "$BEFORE"
    if ! $COMPOSE build >/dev/null 2>&1; then
        log "ВНИМАНИЕ: прежние образы не собрались. Сайт работает, но перед любым"
        log "    перезапуском выполните: bash scripts/vps_update.sh $(short "$BEFORE")"
    fi
}

# --- .env --------------------------------------------------------------------

STEP="проверка .env"
log "Проверка .env"
# Переменные, которые нужны в production, но могли не попасть в .env при
# первой установке (добавлены позже). Дописываем только недостающие.
#
# Домен читаем из .env: при вызове `bash scripts/vps_update.sh` окружение
# не экспортировано, и ${DOMAIN:-} подставил бы пустую строку — в .env уехал
# бы YOOMONEY_REDIRECT_URI=https:///payments/oauth/yoomoney.
ENV_DOMAIN="$(env_get DOMAIN)"
for kv in \
    "YOOMONEY_RETURN_PATH=/profile" \
    "YOOMONEY_REDIRECT_URI=https://${ENV_DOMAIN}/payments/oauth/yoomoney"
do
    k="${kv%%=*}"
    # ^[[:space:]]* — ключ может стоять с отступом.
    if ! grep -qE "^[[:space:]]*${k}=" .env; then
        if [ "$k" = "YOOMONEY_REDIRECT_URI" ] && [ -z "$ENV_DOMAIN" ]; then
            log "    в .env нет DOMAIN — $k не дописываю, впишите вручную"
            continue
        fi
        # env_set сам ставит перевод строки перед ключом, если его не было:
        # иначе ключ приклеился бы к последней строке (/profileYOOMONEY_...).
        env_set "$k" "${kv#*=}"
        log "    дописан $k (проверьте значение)"
    fi
done
unset kv k

# --- Сборка ------------------------------------------------------------------

STEP="сборка образов"
log "Сборка образов"
if ! $COMPOSE build; then
    revert_code
    die "сборка не удалась — сайт работает на прежней версии $(short "$BEFORE")"
fi

STEP="запуск базы"
log "Запуск базы"
$COMPOSE up -d postgres
for i in $(seq 1 60); do
    if $COMPOSE exec -T postgres pg_isready >/dev/null 2>&1; then break; fi
    if [ "$i" = 60 ]; then
        $COMPOSE logs --tail 50 postgres || true
        revert_code
        die "postgres не поднялся"
    fi
    sleep 2
done

# --- Миграции ----------------------------------------------------------------

STEP="миграции"
REV_BEFORE="$(db_revision)"
MIGRATED=0
if [ -n "$REV_BEFORE" ] && ! revision_in_code "$REV_BEFORE"; then
    # Схема базы новее кода: откатились через версию с миграцией. alembic
    # здесь упал бы («Can't locate revision»), а понижать схему опасно —
    # запускаем как есть и говорим, что делать, если не заработает.
    log "Миграции пропущены: схема базы ($REV_BEFORE) новее этой версии кода"
    SCHEMA_AHEAD=1
else
    SCHEMA_AHEAD=0
    log "Миграции БД"
    # Отдельный контейнер в сети compose до перезапуска сервисов, чтобы
    # миграции не гонялись параллельно несколькими воркерами.
    if ! $COMPOSE run --rm --no-deps -T backend alembic upgrade head; then
        if [ "$(db_revision)" != "$REV_BEFORE" ]; then
            log "ВНИМАНИЕ: схема базы изменилась частично ($(db_revision))."
            [ -n "$BACKUP_NAME" ] && log "    Копия до обновления: bash scripts/restore.sh $BACKUP_NAME --db-only"
        fi
        revert_code
        die "миграции не прошли — сайт работает на прежней версии $(short "$BEFORE")"
    fi
    [ "$(db_revision)" = "$REV_BEFORE" ] || MIGRATED=1
fi

# --- Перезапуск --------------------------------------------------------------

STEP="перезапуск"
log "Перезапуск стека"
SWITCHED=1
START_OK=1
$COMPOSE up -d || START_OK=0
if [ "$START_OK" = "1" ]; then
    log "Ожидание backend"
    wait_backend 60 || START_OK=0
fi

if [ "$START_OK" = "0" ]; then
    $COMPOSE logs --tail 50 backend || true
    history_add "$TARGET" failed
    STEP="перезапуск (backend не поднялся)"
    echo ""
    echo "=========================================="
    if [ -n "$REVERTING" ]; then
        # Это уже возврат после неудачного обновления — второй раз не крутим.
        echo " Прежняя версия $(short "$TARGET") тоже не запустилась (журнал backend — выше)."
        if [ "$SCHEMA_AHEAD" = "1" ] && [ -n "$REVERT_BACKUP" ]; then
            echo " Ей, вероятно, мешает схема базы, которую обновила новая версия."
            echo " Вернуть базу на момент перед обновлением (изменения, сделанные"
            echo " за время обновления, пропадут):"
            echo "   bash scripts/restore.sh $REVERT_BACKUP --db-only"
        else
            echo " Причина, скорее всего, не в коде: проверьте место на диске"
            echo " (df -h /), .env и журнал выше."
        fi
        echo "=========================================="
        exit 1
    fi
    echo " Версия $(short "$TARGET") не запустилась (журнал backend — выше)."
    if [ "$TARGET" != "$BEFORE" ]; then
        echo " Вернуть прежнюю: bash scripts/vps_update.sh $(short "$BEFORE")"
        if [ "$MIGRATED" = "1" ] && [ -n "$BACKUP_NAME" ]; then
            echo " Миграции уже применены. Если прежняя версия будет работать с"
            echo " ошибками — база до обновления: bash scripts/restore.sh $BACKUP_NAME --db-only"
        fi
    fi
    echo "=========================================="
    # Без терминала (deploy.bat) спросить некого, а сайт лежит — прежняя
    # версия возвращается сразу. В терминале — вопрос, по умолчанию «да».
    if [ "$TARGET" != "$BEFORE" ] && confirm "Вернуть прежнюю версию $(short "$BEFORE") сейчас?"; then
        log "Возвращаю прежнюю версию $(short "$BEFORE")"
        # Тот же путь, что и при ручном откате; копия базы только что снята.
        rm -f "$MAINT_FILE"
        trap - EXIT
        exec 7>&-
        export SKIP_BACKUP=1 DELO_UPDATE_REVERTING=1 DELO_UPDATE_REVERT_BACKUP="$BACKUP_NAME"
        exec bash "$APP_DIR/scripts/vps_update.sh" "$BEFORE"
    fi
    exit 1
fi

STEP="готово"
history_add "$TARGET" ok

# Чистим старые образы, иначе на диске 9.76 ГБ место кончится за несколько
# обновлений: каждый build оставляет предыдущий слой.
docker image prune -f >/dev/null 2>&1 || true

# Сайт снаружи — через Caddy, как его видят пользователи (без DNS).
SITE_CHECK=""
if [ -n "$ENV_DOMAIN" ]; then
    if curl -fsS -o /dev/null -m 15 --resolve "$ENV_DOMAIN:443:127.0.0.1" "https://$ENV_DOMAIN/health" 2>/dev/null; then
        SITE_CHECK="отвечает по HTTPS"
    else
        SITE_CHECK="НЕ отвечает по HTTPS — docker compose -f docker-compose.prod.yml logs --tail 50 caddy"
    fi
fi

# Домен берём из .env, а не из окружения: при запуске через `bash script.sh`
# ничего не экспортировано, и любая непроверенная переменная под `set -u`
# роняет скрипт на последней строке (уже случалось).
SITE_URL="$(env_get FRONTEND_URL)"
[ -n "$SITE_URL" ] || SITE_URL="$(env_get DOMAIN)"
[ -n "$SITE_URL" ] || SITE_URL="(домен не задан)"
PREV="$(rollback_target "$TARGET")"

echo ""
echo "=========================================="
if [ -n "$REVERTING" ]; then
    echo " Сайт снова работает: $SITE_URL${SITE_CHECK:+ — $SITE_CHECK}"
else
    echo " Готово: $SITE_URL${SITE_CHECK:+ — $SITE_CHECK}"
fi
echo " Версия: $(short "$TARGET") $(subject "$TARGET")"
[ -n "$PREV" ] && echo " Откат:  bash scripts/vps_update.sh --rollback   (вернёт $(short "$PREV"))"
[ -n "$BACKUP_NAME" ] && echo " Копия базы до обновления: $BACKUP_NAME"
if [ "$SCHEMA_AHEAD" = "1" ]; then
    echo ""
    echo " Схема базы новее кода (миграции не применялись). Если что-то"
    echo " работает с ошибками — база той же версии:"
    echo "   bash scripts/backup.sh --list   и   bash scripts/restore.sh ИМЯ --db-only"
    echo " (подходят копии pre-update-$(short "$TARGET"))"
fi
echo " Логи:   $COMPOSE logs -f backend"
echo "=========================================="
if [ -n "$REVERTING" ]; then
    # Сайт снова работает, но обновление-то не удалось: deploy.bat и всё,
    # что смотрит на код возврата, должны это увидеть.
    echo "Обновление НЕ удалось: версия $(short "$BEFORE") не запустилась, возвращена прежняя $(short "$TARGET")."
    exit 1
fi
if ! cron_installed; then
    echo "Резервные копии по расписанию не включены: bash scripts/backup.sh --install"
elif ! alert_configured; then
    echo "Уведомления о сбоях в Telegram не настроены: bash scripts/monitor.sh --setup"
elif ! offsite_configured; then
    echo "Копии хранятся только на этом сервере. Выгрузка в облако: bash scripts/offsite.sh --setup"
fi
