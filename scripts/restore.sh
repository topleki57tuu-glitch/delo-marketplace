#!/usr/bin/env bash
# ============================================================================
# Восстановление «ДЕЛО» из резервной копии (её делает scripts/backup.sh).
#
#   bash scripts/restore.sh                 список копий
#   bash scripts/restore.sh ИМЯ             восстановить базу и файлы
#   bash scripts/restore.sh latest          из последней копии
#   bash scripts/restore.sh ИМЯ --db-only   только базу
#
# Порядок выбран так, чтобы на любом шаге можно было вернуться:
#   1. проверка копии: контрольные суммы, оглавление дампа, версия схемы;
#   2. копия текущего состояния с меткой pre-restore — если восстановили
#      не то, к нему возвращаются этой же командой;
#   3. остановка backend, воркера, планировщика и бота: пока идёт
#      восстановление, в базу никто не пишет (сайт отвечает ошибкой);
#   4. база разворачивается во временную — рабочая не тронута, пока
#      временная не собрана целиком;
#   5. подмена: рабочая база становится запасной, временная — рабочей;
#      файлы — так же, распаковка рядом и подмена;
#   6. миграции до версии кода, запуск, проверка /health. Не поднялось —
#      база и файлы возвращаются как были, сайт запускается на них.
# Запасная база удаляется только после успешного запуска.
#
# Флаги: --yes — не спрашивать подтверждения; --no-safety-backup — без
# копии текущего состояния (только если её сделать негде).
# ============================================================================
set -Eeuo pipefail

# shellcheck source=scripts/ops_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/ops_common.sh"
cd "$APP_DIR"

TARGET=""
DB_ONLY=0
YES=0
SAFETY=1
while [ $# -gt 0 ]; do
    case "$1" in
        --db-only) DB_ONLY=1 ;;
        --yes|-y) YES=1 ;;
        --no-safety-backup) SAFETY=0 ;;
        -h|--help) sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) die "неизвестный флаг: $1 (справка: bash scripts/restore.sh --help)" ;;
        *) [ -z "$TARGET" ] || die "укажите одну копию"; TARGET="$1" ;;
    esac
    shift
done

if [ -z "$TARGET" ]; then
    bash "$APP_DIR/scripts/backup.sh" --list
    exit 0
fi
[ -f .env ] || die "нет .env в $APP_DIR"

if [ "$TARGET" = "latest" ]; then
    TARGET="$(for d in "$BACKUP_DIR"/*/; do [ -f "$d/OK" ] && basename "$d"; done 2>/dev/null | sort | tail -n 1)"
    [ -n "$TARGET" ] || die "готовых копий в $BACKUP_DIR нет"
fi
if [ -d "$TARGET" ]; then
    DIR="$(cd "$TARGET" && pwd)"
else
    DIR="$BACKUP_DIR/$TARGET"
fi
[ -d "$DIR" ] || die "копия не найдена: $TARGET (список: bash scripts/restore.sh)"
[ -f "$DIR/OK" ] || die "копия $(basename "$DIR") не завершена или не прошла проверку (нет файла OK)"
NAME="$(basename "$DIR")"
manifest() { grep -m1 "^$1=" "$DIR/manifest.txt" 2>/dev/null | cut -d= -f2- || true; }

if [ "$DB_ONLY" = "0" ] && [ ! -f "$DIR/uploads.tar.gz" ]; then
    log "В копии $NAME только база — файлы восстанавливаться не будут."
    DB_ONLY=1
fi

USER_="$(pg_user)"
DB="$(pg_db)"
STAMP="$(date '+%Y%m%d_%H%M%S')"
NEW_DB="${DB}_restoring"
OLD_DB="${DB}_before_restore_${STAMP}"

# Одновременно с копированием нельзя: ночная копия прочитала бы базу
# посреди подмены. Копия pre-restore снимается под этим же замком.
mkdir -p "$BACKUP_DIR"
exec 9> "$BACKUP_DIR/.lock"
flock -n 9 || die "идёт резервное копирование — повторите через несколько минут"
export DELO_BACKUP_LOCK_HELD=1

log "Проверка копии $NAME"
if ! postgres_running; then
    $COMPOSE up -d postgres >/dev/null
    for i in $(seq 1 60); do
        $COMPOSE exec -T postgres pg_isready >/dev/null 2>&1 && break
        [ "$i" = 60 ] && die "postgres не поднялся"
        sleep 2
    done
fi
bash "$APP_DIR/scripts/backup.sh" --verify "$DIR" --quick | sed 's/^/    /' \
    || die "копия $NAME повреждена — восстановление отменено"

REV="$(manifest alembic_revision)"
if [ -n "$REV" ] && ! revision_in_code "$REV"; then
    die "схема в копии ($REV) новее текущего кода. Сначала верните код той версии,
         с которой снята копия: bash scripts/vps_update.sh $(manifest git_commit | cut -c1-12)
         — и повторите восстановление."
fi

CREATED="$(date -d "$(manifest created_at)" '+%d.%m.%Y %H:%M' 2>/dev/null || manifest created_at)"
case "$(manifest kind)" in
    full) KIND="база, файлы и .env" ;;
    db-only) KIND="только база" ;;
    *) KIND="$(manifest kind)" ;;
esac
echo ""
echo "  Копия:   $NAME ($KIND), снята $CREATED"
echo "  Код:     $(manifest git_commit | cut -c1-12) $(manifest git_subject)"
echo "  Схема:   ${REV:-нет}"
echo "  Строк:   пользователи $(manifest rows_after.users), задания $(manifest rows_after.tasks), транзакции $(manifest rows_after.transactions)"
echo ""
echo "  Будет заменено: база $DB$([ "$DB_ONLY" = "0" ] && echo " и загруженные файлы")."
echo "  Всё, что изменилось после $CREATED, пропадёт с сайта"
[ "$SAFETY" = "1" ] && echo "  (но останется в копии текущего состояния, она будет сделана сейчас)."
echo ""
if [ "$YES" != "1" ]; then
    read -rp "Введите yes, чтобы восстановить: " ANSWER
    [ "$ANSWER" = "yes" ] || die "отменено"
fi

if [ "$SAFETY" = "1" ]; then
    log "Копия текущего состояния (pre-restore)"
    SAFETY_ARGS=(--tag pre-restore --quick)
    [ "$DB_ONLY" = "1" ] && SAFETY_ARGS+=(--db-only)
    bash "$APP_DIR/scripts/backup.sh" "${SAFETY_ARGS[@]}" | sed 's/^/    /' \
        || die "не удалось сделать копию текущего состояния — восстановление отменено
         (без неё: --no-safety-backup)"
fi

STOPPED=0
SWAPPED_DB=0
SWAPPED_FILES=0
DONE=0

uploads_sh() {
    # Файлы — во временном контейнере backend: сам backend остановлен,
    # а том с файлами тот же.
    $COMPOSE run --rm --no-deps -T backend sh -c "$1"
}

revert() {
    log "Возвращаю базу и файлы, как было до восстановления"
    if [ "$SWAPPED_DB" = "1" ]; then
        $COMPOSE stop backend worker beat bot >/dev/null 2>&1 || true
        pg_psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid()" >/dev/null || true
        pg_psql -d postgres -c "ALTER DATABASE \"$DB\" RENAME TO \"${DB}_failed_restore_${STAMP}\"" >/dev/null \
            && pg_psql -d postgres -c "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$DB\"" >/dev/null \
            && SWAPPED_DB=0 \
            && log "    база возвращена (неудачная — ${DB}_failed_restore_${STAMP}, удалите вручную)"
    fi
    if [ "$SWAPPED_FILES" = "1" ]; then
        uploads_sh 'set -e; cd /app/uploads
            find . -mindepth 1 -maxdepth 1 ! -name .previous -exec rm -rf {} +
            find .previous -mindepth 1 -maxdepth 1 -exec mv -t . {} +
            rmdir .previous' && SWAPPED_FILES=0 && log "    файлы возвращены"
    fi
}

on_exit() {
    local code=$?
    rm -f "$STATE_DIR/maintenance"
    if [ "$code" -ne 0 ] && [ "$DONE" = "0" ]; then
        pg_psql -d postgres -c "DROP DATABASE IF EXISTS \"$NEW_DB\"" >/dev/null 2>&1 || true
        if [ "$SWAPPED_DB" = "1" ] || [ "$SWAPPED_FILES" = "1" ]; then
            revert || true
        fi
        if [ "$STOPPED" = "1" ]; then
            log "Запускаю сайт на прежних данных"
            $COMPOSE up -d >/dev/null 2>&1 || true
        fi
        [ "$SWAPPED_DB" = "1" ] && log "ВНИМАНИЕ: базу вернуть не удалось — рабочая база: $DB, прежняя: $OLD_DB"
    fi
}
trap on_exit EXIT

# Пока сайт остановлен, мониторинг не шлёт уведомлений (scripts/monitor.sh).
mkdir -p "$STATE_DIR" && echo "восстановление из $NAME" > "$STATE_DIR/maintenance"

log "Останавливаю backend, worker, beat и bot"
STOPPED=1
$COMPOSE stop backend worker beat bot >/dev/null

log "База: разворачиваю копию во временную $NEW_DB"
pg_psql -d postgres -c "DROP DATABASE IF EXISTS \"$NEW_DB\"" >/dev/null
pg_psql -d postgres -c "CREATE DATABASE \"$NEW_DB\"" >/dev/null
if ! $COMPOSE exec -T postgres pg_restore -U "$USER_" -d "$NEW_DB" --no-owner --exit-on-error --single-transaction \
        < "$DIR/db.dump"; then
    die "pg_restore не удался — рабочая база не тронута"
fi
[ "$(db_revision "$NEW_DB")" = "$REV" ] || die "после восстановления схема '$(db_revision "$NEW_DB")', ожидалась '$REV' — рабочая база не тронута"

log "База: подмена ($DB -> $OLD_DB, $NEW_DB -> $DB)"
pg_psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB', '$NEW_DB') AND pid <> pg_backend_pid()" >/dev/null
pg_psql -d postgres -c "ALTER DATABASE \"$DB\" RENAME TO \"$OLD_DB\"" >/dev/null
SWAPPED_DB=1
if ! pg_psql -d postgres -c "ALTER DATABASE \"$NEW_DB\" RENAME TO \"$DB\"" >/dev/null; then
    pg_psql -d postgres -c "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$DB\"" >/dev/null && SWAPPED_DB=0
    die "подмена базы не удалась — рабочая база возвращена"
fi

if [ "$DB_ONLY" = "0" ]; then
    log "Файлы: распаковываю копию и подменяю /app/uploads"
    uploads_sh 'set -e; cd /app/uploads
        rm -rf .restoring .previous
        mkdir .restoring
        tar -xzf - -C .restoring
        mkdir .previous
        find . -mindepth 1 -maxdepth 1 ! -name .restoring ! -name .previous -exec mv -t .previous {} +
        find .restoring -mindepth 1 -maxdepth 1 -exec mv -t . {} +
        rmdir .restoring' < "$DIR/uploads.tar.gz" || die "файлы восстановить не удалось"
    SWAPPED_FILES=1
fi

# В Redis — кэш ленты заданий, счётчики лимитов и очередь фоновых задач,
# собранные на прежних данных.
$COMPOSE exec -T redis redis-cli FLUSHALL >/dev/null 2>&1 || log "    (Redis не очищен — кэш обновится сам в течение минуты)"

log "Миграции до версии кода"
$COMPOSE run --rm --no-deps -T backend alembic upgrade head || die "миграции не прошли"

log "Запуск"
$COMPOSE up -d >/dev/null
if ! wait_backend 60; then
    $COMPOSE logs --tail 40 backend || true
    die "backend не поднялся на восстановленной базе"
fi
STOPPED=0

DONE=1
pg_psql -d postgres -c "DROP DATABASE IF EXISTS \"$OLD_DB\"" >/dev/null || log "    прежняя база $OLD_DB не удалена — удалите вручную"
if [ "$SWAPPED_FILES" = "1" ]; then
    $COMPOSE exec -T backend rm -rf /app/uploads/.previous || true
fi

echo ""
echo "=========================================="
echo " Восстановлено из $NAME"
echo " Пользователей: $(pg_value "$DB" "SELECT count(*) FROM users" 2>/dev/null || echo '?'), заданий: $(pg_value "$DB" "SELECT count(*) FROM tasks" 2>/dev/null || echo '?')"
[ "$SAFETY" = "1" ] && echo " Вернуть как было: bash scripts/restore.sh $(for d in "$BACKUP_DIR"/*-pre-restore/; do [ -f "$d/OK" ] && basename "$d"; done 2>/dev/null | sort | tail -n 1)"
echo "=========================================="
