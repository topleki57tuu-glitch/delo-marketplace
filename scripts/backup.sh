#!/usr/bin/env bash
# ============================================================================
# Резервная копия «ДЕЛО»: база, загруженные файлы и .env — с проверкой.
#
#   bash scripts/backup.sh               сделать копию сейчас
#   bash scripts/backup.sh --install     копии каждую ночь + мониторинг по
#                                        расписанию, и сразу первая копия
#   bash scripts/backup.sh --list        список копий
#   bash scripts/backup.sh --verify ИМЯ  проверить копию ещё раз
#
# Восстановление — scripts/restore.sh. Подробнее — docs/UPDATE_GUIDE.md,
# раздел «Резервные копии».
#
# Каждая копия — каталог /var/backups/delo/ГГГГ-ММ-ДД_ЧЧММСС[-метка]:
#   db.dump          база (pg_dump, сжатый формат custom)
#   uploads.tar.gz   файлы из тома backend_uploads
#   env              копия .env: в ней SECRET_KEY, без которого не прочитать
#                    зашифрованные номера документов из базы
#   manifest.txt     дата, версия кода, ревизия схемы, число строк в таблицах
#   SHA256SUMS       контрольные суммы
#   OK               копия собрана и прошла проверку
#
# Проверка — не «файл не пустой», а настоящее восстановление: дамп
# разворачивается во временную базу рядом с рабочей, сверяются ревизия схемы,
# состав таблиц и строки, временная база удаляется. Копия без OK не считается
# копией: ни restore.sh, ни мониторинг её не учитывают.
#
# Копии лежат на том же сервере: от неудачного обновления и случайного
# удаления они спасают, от потери сервера — нет. Для этого — облачное
# хранилище: после bash scripts/offsite.sh --setup каждая полная копия без
# метки сама выгружается туда, зашифрованной. Не выгрузилась — копия на
# сервере всё равно готова, а сбой покажет scripts/monitor.sh.
#
# Служебные ключи (ими пользуется сам проект):
#   --cron         запуск по расписанию: при ошибке — уведомление в Telegram
#   --db-only      только база (так делает vps_update.sh перед обновлением)
#   --quick        проверка без восстановления: контрольные суммы и
#                  оглавление дампа
#   --tag МЕТКА    метка в имени каталога (pre-update-…, pre-restore)
#   --latest       путь к последней полной копии — так её находит
#                  download-backup.bat; копий нет — код 3
#
# Настройки в .env (необязательно):
#   BACKUP_DIR=/var/backups/delo  BACKUP_KEEP_DAYS=7  BACKUP_KEEP_TAGGED=5
# ============================================================================
set -Eeuo pipefail

# shellcheck source=scripts/ops_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/ops_common.sh"
cd "$APP_DIR"

usage() { sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

MODE=backup
DB_ONLY=0
QUICK=0
CRON=0
TAG=""
TARGET=""
while [ $# -gt 0 ]; do
    case "$1" in
        --install) MODE=install ;;
        --list) MODE=list ;;
        --latest) MODE=latest ;;
        --verify)
            [ $# -ge 2 ] || die "укажите копию: bash scripts/backup.sh --verify ИМЯ (список: --list)"
            MODE=verify; TARGET="$2"; shift ;;
        --cron) CRON=1 ;;
        --db-only) DB_ONLY=1 ;;
        --quick) QUICK=1 ;;
        --tag)
            [ $# -ge 2 ] || die "--tag требует значения"
            TAG="$(printf '%s' "$2" | tr -c 'A-Za-z0-9._-' '-')"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "неизвестный аргумент: $1 (справка: bash scripts/backup.sh --help)" ;;
    esac
    shift
done

KEEP_DAYS="$(env_get BACKUP_KEEP_DAYS 7)"
KEEP_TAGGED="$(env_get BACKUP_KEEP_TAGGED 5)"
# Сколько последних копий не удаляется никогда — ни по сроку, ни ради места.
KEEP_MIN=2
NAME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}(-[A-Za-z0-9._-]+)?$'

# --- Список копий ------------------------------------------------------------

# Готовые копии (с OK), от старых к новым. Имя начинается с даты, поэтому
# сортировка по имени — это сортировка по времени.
complete_backups() {
    local d
    [ -d "$BACKUP_DIR" ] || return 0
    for d in "$BACKUP_DIR"/*/; do
        d="$(basename "$d")"
        [[ "$d" =~ $NAME_RE ]] || continue
        [ -f "$BACKUP_DIR/$d/OK" ] && echo "$d"
    done | sort
}

manifest_get() {
    grep -m1 "^$2=" "$1/manifest.txt" 2>/dev/null | cut -d= -f2- || true
}

resolve_backup() {
    local arg="$1"
    if [ "$arg" = "latest" ]; then
        arg="$(complete_backups | tail -n 1)"
        [ -n "$arg" ] || die "готовых копий нет"
    fi
    if [ -d "$arg" ]; then
        (cd "$arg" && pwd)
    elif [ -d "$BACKUP_DIR/$arg" ]; then
        echo "$BACKUP_DIR/$arg"
    else
        die "копия не найдена: $arg (список: bash scripts/backup.sh --list)"
    fi
}

list_backups() {
    local names n d kind size
    names="$(complete_backups)"
    if [ -z "$names" ]; then
        echo "Готовых копий в $BACKUP_DIR нет. Сделать: bash scripts/backup.sh"
        return 0
    fi
    # Ширину printf считает в байтах, кириллица заняла бы вдвое больше —
    # поэтому заголовок выровнен вручную, а русский текст только в последней
    # колонке.
    echo "КОПИЯ                                  КОД      СХЕМА         РАЗМЕР  СОСТАВ"
    while read -r n; do
        d="$BACKUP_DIR/$n"
        case "$(manifest_get "$d" kind)" in
            full) kind="база, файлы, .env" ;;
            db-only) kind="только база" ;;
            *) kind="?" ;;
        esac
        size="$(du -sh "$d" 2>/dev/null | cut -f1)"
        printf '%-38s %-8s %-13s %-7s %s\n' "$n" "$(manifest_get "$d" git_commit | cut -c1-7)" \
            "$(manifest_get "$d" alembic_revision)" "$size" "$kind"
    done <<< "$names"
    echo ""
    echo "Каталог: $BACKUP_DIR. Восстановить: bash scripts/restore.sh ИМЯ"
}

# --- Данные для манифеста и проверки -----------------------------------------

# «таблица число» для каждой таблицы схемы public — точные count(*), одним
# запросом.
TABLE_COUNTS_SQL="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

table_counts() {
    pg_value "$1" "$TABLE_COUNTS_SQL"
}

# Команда в контейнере backend: в работающем, а если он остановлен — во
# временном (тот же образ и тот же том с файлами).
backend_sh() {
    if [ -n "$($COMPOSE ps -q --status running backend 2>/dev/null)" ]; then
        $COMPOSE exec -T backend sh -c "$1"
    else
        $COMPOSE run --rm --no-deps -T backend sh -c "$1"
    fi
}

# --- Проверка копии ----------------------------------------------------------

VERIFY_DB=""
drop_verify_db() {
    if [ -n "$VERIFY_DB" ]; then
        pg_psql -d postgres -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\"" >/dev/null 2>&1 || true
        VERIFY_DB=""
    fi
}

# verify_backup КАТАЛОГ — контрольные суммы, оглавление дампа, архив файлов и
# (без --quick) пробное восстановление во временную базу. Результат — в
# КАТАЛОГ/verify.txt; ненулевой код — копия негодна.
verify_backup() {
    local dir="$1" user report rev_manifest rev_restored line table before after restored missing=0 empty=0
    user="$(pg_user)"
    report="$dir/verify.txt"
    : > "$report"

    [ -f "$dir/SHA256SUMS" ] || { echo "нет SHA256SUMS" >> "$report"; return 1; }
    if ! (cd "$dir" && sha256sum -c --quiet SHA256SUMS) >> "$report" 2>&1; then
        echo "контрольные суммы не сходятся" >> "$report"
        return 1
    fi
    echo "контрольные суммы: ок" >> "$report"

    if ! $COMPOSE exec -T postgres pg_restore -l < "$dir/db.dump" > /dev/null 2>> "$report"; then
        echo "оглавление дампа не читается" >> "$report"
        return 1
    fi
    echo "оглавление дампа: ок" >> "$report"

    if [ -f "$dir/uploads.tar.gz" ]; then
        local entries expected
        if ! entries="$(tar -tzf "$dir/uploads.tar.gz" 2>> "$report" | wc -l)"; then
            echo "архив файлов повреждён" >> "$report"
            return 1
        fi
        expected="$(manifest_get "$dir" uploads_entries)"
        if [ -n "$expected" ] && [ "$entries" != "$expected" ]; then
            echo "в архиве файлов $entries записей, ожидалось $expected" >> "$report"
            return 1
        fi
        echo "архив файлов: ок ($entries записей)" >> "$report"
    fi

    if [ "$QUICK" = "1" ]; then
        echo "восстановление не проверялось (--quick)" >> "$report"
        return 0
    fi

    VERIFY_DB="delo_verify_$(date +%s)_$$"
    pg_psql -d postgres -c "CREATE DATABASE \"$VERIFY_DB\"" >/dev/null
    if ! $COMPOSE exec -T postgres pg_restore -U "$user" -d "$VERIFY_DB" --no-owner --exit-on-error \
            < "$dir/db.dump" >> "$report" 2>&1; then
        echo "пробное восстановление не удалось" >> "$report"
        drop_verify_db
        return 1
    fi

    rev_manifest="$(manifest_get "$dir" alembic_revision)"
    rev_restored="$(db_revision "$VERIFY_DB")"
    if [ "$rev_manifest" != "$rev_restored" ]; then
        echo "ревизия схемы после восстановления: '${rev_restored}', в манифесте: '${rev_manifest}'" >> "$report"
        drop_verify_db
        return 1
    fi

    # Сверка таблиц. Строки считались до и после pg_dump, а дамп — снимок на
    # момент между ними, поэтому точного числа ждать нельзя: сайт работает.
    # Ловим то, что означает испорченную копию: таблицы нет, или таблица,
    # где строки были и до, и после дампа, восстановилась пустой.
    local restored_counts
    restored_counts="$(table_counts "$VERIFY_DB")"
    drop_verify_db
    while read -r line; do
        [ -n "$line" ] || continue
        table="${line%% *}"
        before="$(manifest_get "$dir" "rows_before.$table")"
        after="$(manifest_get "$dir" "rows_after.$table")"
        restored="$(awk -v t="$table" '$1 == t { print $2 }' <<< "$restored_counts")"
        if [ -z "$restored" ]; then
            echo "таблицы $table нет в восстановленной базе" >> "$report"
            missing=$((missing + 1))
        elif [ "${before:-0}" -gt 0 ] && [ "${after:-0}" -gt 0 ] && [ "$restored" -eq 0 ]; then
            echo "таблица $table восстановилась пустой (до дампа: $before, после: $after)" >> "$report"
            empty=$((empty + 1))
        fi
    done < <(grep '^rows_after\.' "$dir/manifest.txt" | sed 's/^rows_after\.//; s/=/ /')
    if [ "$missing" -gt 0 ] || [ "$empty" -gt 0 ]; then
        return 1
    fi
    echo "пробное восстановление: ок (ревизия $rev_restored, таблиц: $(grep -c '^rows_after\.' "$dir/manifest.txt"))" >> "$report"
    return 0
}

# --- Удаление старых копий ---------------------------------------------------

remove_backup() {
    log "    удаляю старую копию $1"
    rm -rf -- "${BACKUP_DIR:?}/$1"
}

prune_old() {
    local all newest cutoff n untagged tagged count
    all="$(complete_backups)"
    [ -n "$all" ] || return 0
    newest="$(tail -n "$KEEP_MIN" <<< "$all")"
    cutoff="$(date -d "-$KEEP_DAYS days" '+%Y-%m-%d_%H%M%S')"

    # Обычные (без метки) — по сроку.
    untagged="$(grep -E '^[0-9_-]{17}$' <<< "$all" || true)"
    while read -r n; do
        [ -n "$n" ] || continue
        grep -qxF "$n" <<< "$newest" && continue
        [[ "$n" < "$cutoff" ]] && remove_backup "$n"
    done <<< "$untagged"

    # С меткой (перед обновлением, перед восстановлением) — по количеству.
    tagged="$(grep -vE '^[0-9_-]{17}$' <<< "$all" || true)"
    count="$(grep -c . <<< "$tagged" || true)"
    while read -r n; do
        [ -n "$n" ] || continue
        [ "$count" -gt "$KEEP_TAGGED" ] || break
        grep -qxF "$n" <<< "$newest" && continue
        remove_backup "$n"
        count=$((count - 1))
    done <<< "$tagged"

    # Недособранные копии старше суток — остатки прерванных запусков.
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mtime +0 -exec rm -rf {} + 2>/dev/null || true
}

# Освободить место под новую копию: удаляем самые старые, кроме KEEP_MIN
# последних. Обычные раньше помеченных: копия «перед обновлением» ценнее.
make_room() {
    local need="$1" n all candidates
    all="$(complete_backups)"
    candidates="$( (grep -E '^[0-9_-]{17}$' <<< "$all" || true; grep -vE '^[0-9_-]{17}$' <<< "$all" || true) | grep . || true)"
    while read -r n; do
        [ -n "$n" ] || continue
        [ "$(free_bytes "$BACKUP_DIR")" -ge "$need" ] && return 0
        [ "$(complete_backups | wc -l)" -le "$KEEP_MIN" ] && return 0
        tail -n "$KEEP_MIN" <<< "$all" | grep -qxF "$n" && continue
        remove_backup "$n"
    done <<< "$candidates"
}

# --- Копия -------------------------------------------------------------------

PARTIAL=""
FAIL_REASON=""

on_exit() {
    local code=$?
    drop_verify_db
    if [ "$code" -ne 0 ] && [ "$MODE" = "backup" ]; then
        [ -n "$PARTIAL" ] && rm -rf -- "$PARTIAL"
        mkdir -p "$BACKUP_DIR" 2>/dev/null || true
        printf 'failed %s %s\n' "$(date +%s)" "${FAIL_REASON:-код $code}" > "$BACKUP_DIR/last_status" 2>/dev/null || true
        if [ "$CRON" = "1" ]; then
            send_alert "Резервная копия НЕ создана: ${FAIL_REASON:-ошибка, код $code}. Журнал: $LOG_DIR/delo-backup.log" || true
        fi
    fi
}
trap on_exit EXIT
trap 'FAIL_REASON="${FAIL_REASON:-строка $LINENO: $BASH_COMMAND}"' ERR

do_backup() {
    local user db name dir started db_bytes up_bytes=0 need free entries commit subject rev kind
    user="$(pg_user)"
    db="$(pg_db)"
    started="$(date +%s)"

    # Ночная копия посреди обновления или восстановления поймала бы
    # перезапуск контейнеров (или упёрлась бы в замок restore.sh) — ждём
    # до получаса, пока закончится.
    if [ "$CRON" = "1" ] && maintenance_active; then
        log "Идёт обслуживание ($(cat "$STATE_DIR/maintenance" 2>/dev/null)) — жду окончания"
        for _ in $(seq 1 30); do
            maintenance_active || break
            sleep 60
        done
    fi

    postgres_running || die "контейнер postgres не запущен — копию снять не с чего ($COMPOSE up -d postgres)"

    mkdir -p "$BACKUP_DIR" || die "не создать $BACKUP_DIR (запускайте от root)"
    chmod 700 "$BACKUP_DIR"

    # Одновременно — только одна копия или восстановление. restore.sh держит
    # замок сам и снимает копию «перед восстановлением» этим же скриптом.
    if [ -z "${DELO_BACKUP_LOCK_HELD:-}" ]; then
        exec 9> "$BACKUP_DIR/.lock"
        flock -n 9 || die "уже идёт другая копия или восстановление"
    fi

    name="$(date '+%Y-%m-%d_%H%M%S')${TAG:+-$TAG}"
    # Вторая копия в ту же секунду получила бы то же имя, и mv положил бы
    # её внутрь первой — ждём следующую секунду.
    while [ -e "$BACKUP_DIR/$name" ]; do
        sleep 1
        name="$(date '+%Y-%m-%d_%H%M%S')${TAG:+-$TAG}"
    done
    dir="$BACKUP_DIR/$name"
    kind="full"
    [ "$DB_ONLY" = "1" ] && kind="db-only"
    log "Резервная копия $name ($kind) -> $BACKUP_DIR"

    # Место: дамп обычно меньше базы, файлы почти не сжимаются; для пробного
    # восстановления базе нужно столько же места ещё раз (тот же диск).
    db_bytes="$(pg_value "$db" "SELECT pg_database_size(current_database())" | tr -d '[:space:]')"
    if [ "$DB_ONLY" = "0" ]; then
        up_bytes="$(backend_sh 'du -sb /app/uploads 2>/dev/null | cut -f1' | tr -d '[:space:]' || true)"
        up_bytes="${up_bytes:-0}"
    fi
    need=$((db_bytes + up_bytes + 64 * 1024 * 1024))
    [ "$QUICK" = "0" ] && need=$((need + db_bytes))
    free="$(free_bytes "$BACKUP_DIR")"
    if [ "$free" -lt "$need" ]; then
        log "    свободно $(human_size "$free"), нужно ~$(human_size "$need") — удаляю самые старые копии"
        make_room "$need"
        free="$(free_bytes "$BACKUP_DIR")"
    fi
    [ "$free" -ge "$need" ] || die "мало места на диске: свободно $(human_size "$free"), нужно ~$(human_size "$need")"

    PARTIAL="$dir.partial"
    rm -rf -- "$PARTIAL"
    mkdir -m 700 "$PARTIAL"

    commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    subject="$(git log -1 --format=%s 2>/dev/null | tr -d '\n' || true)"
    rev="$(db_revision "$db")"
    {
        echo "created_at=$(date -Iseconds)"
        echo "kind=$kind"
        echo "tag=$TAG"
        echo "host=$(hostname 2>/dev/null || true)"
        echo "domain=$(env_get DOMAIN)"
        echo "git_commit=$commit"
        echo "git_subject=$subject"
        echo "database=$db"
        echo "database_size_bytes=$db_bytes"
        echo "alembic_revision=$rev"
        table_counts "$db" | sed 's/^/rows_before./; s/ /=/'
    } > "$PARTIAL/manifest.txt"

    log "    база $db ($(human_size "$db_bytes")) -> db.dump"
    if ! $COMPOSE exec -T postgres pg_dump -U "$user" -d "$db" -Fc > "$PARTIAL/db.dump" 2> "$PARTIAL/pg_dump.log"; then
        die "pg_dump: $(tail -n 3 "$PARTIAL/pg_dump.log" | tr '\n' ' ')"
    fi
    [ -s "$PARTIAL/db.dump" ] || die "pg_dump записал пустой файл"
    rm -f "$PARTIAL/pg_dump.log"
    table_counts "$db" | sed 's/^/rows_after./; s/ /=/' >> "$PARTIAL/manifest.txt"

    if [ "$DB_ONLY" = "0" ]; then
        log "    файлы /app/uploads ($(human_size "$up_bytes")) -> uploads.tar.gz"
        if ! backend_sh 'cd /app/uploads && tar -czf - .' > "$PARTIAL/uploads.tar.gz"; then
            die "не удалось упаковать /app/uploads"
        fi
        entries="$(tar -tzf "$PARTIAL/uploads.tar.gz" | wc -l)"
        echo "uploads_entries=$entries" >> "$PARTIAL/manifest.txt"
    fi

    install -m 600 .env "$PARTIAL/env"

    (cd "$PARTIAL" && sha256sum -- * > SHA256SUMS)

    log "    проверка$([ "$QUICK" = "1" ] && echo " (быстрая)" || echo " восстановлением во временную базу")"
    if ! verify_backup "$PARTIAL"; then
        die "копия не прошла проверку: $(grep -v ': ок' "$PARTIAL/verify.txt" | tail -n 3 | tr '\n' ' ')"
    fi
    sed 's/^/      /' "$PARTIAL/verify.txt"

    date -Iseconds > "$PARTIAL/OK"
    mv -- "$PARTIAL" "$dir"
    PARTIAL=""
    printf 'ok %s %s\n' "$(date +%s)" "$name" > "$BACKUP_DIR/last_status"

    prune_old
    log "Готово: $dir ($(du -sh "$dir" | cut -f1), $(( $(date +%s) - started )) с)"

    # Копия вне сервера. Копии с меткой (перед обновлением, перед
    # восстановлением) не выгружаются: они нужны здесь и сейчас, а выгрузка
    # задержала бы обновление.
    if [ "$kind" = "full" ] && [ -z "$TAG" ] && offsite_configured; then
        if ! DELO_BACKUP_LOCK_HELD=1 bash "$APP_DIR/scripts/offsite.sh" --push "$name"; then
            log "ВНИМАНИЕ: копия не выгружена в облачное хранилище (причина выше). Повторить: bash scripts/offsite.sh"
        fi
    fi
}

case "$MODE" in
    list)
        list_backups
        ;;
    latest)
        # В stdout — только путь: его читает download-backup.bat. Остальное —
        # в stderr, человеку.
        NAME="$(latest_full_backup)"
        if [ -z "$NAME" ]; then
            log "ОШИБКА: готовых полных копий нет. Сделать первую и включить ночные: bash scripts/backup.sh --install" >&2
            exit 3
        fi
        AGE_H=$(( ($(date +%s) - $(stat -c %Y "$BACKUP_DIR/$NAME/OK")) / 3600 ))
        if ! grep -qs 'backup.sh' "$CRON_FILE"; then
            log "ВНИМАНИЕ: ночные копии не включены, эта снята $AGE_H ч назад. Включить: bash scripts/backup.sh --install" >&2
        elif [ "$AGE_H" -ge "$(env_get MONITOR_BACKUP_HOURS 26)" ]; then
            log "ВНИМАНИЕ: последняя копия снята $AGE_H ч назад — ночные копии не обновляются. Журнал: $LOG_DIR/delo-backup.log" >&2
        fi
        echo "$BACKUP_DIR/$NAME"
        ;;
    verify)
        DIR="$(resolve_backup "$TARGET")"
        if [ -z "${DELO_BACKUP_LOCK_HELD:-}" ]; then
            exec 9> "$BACKUP_DIR/.lock"
            flock -n 9 || die "идёт копия или восстановление — повторите позже"
        fi
        if verify_backup "$DIR"; then
            cat "$DIR/verify.txt"
            echo "Копия $(basename "$DIR") в порядке."
        else
            cat "$DIR/verify.txt"
            die "копия $(basename "$DIR") негодна"
        fi
        ;;
    install)
        [ -w "$(dirname "$CRON_FILE")" ] || die "нет прав на $(dirname "$CRON_FILE") — запускайте от root"
        install_cron
        log "Расписание записано: $CRON_FILE"
        log "    копия — каждую ночь в 00:30 (время сервера: $(date +%Z)), хранится $KEEP_DAYS дн."
        log "    мониторинг — каждые 5 минут"
        if ! command -v cron >/dev/null 2>&1 && ! systemctl is-active --quiet cron 2>/dev/null; then
            log "ВНИМАНИЕ: служба cron не найдена — расписание не сработает (apt-get install -y cron)"
        fi
        MODE=backup
        do_backup
        echo ""
        echo "Уведомления о сбоях в Telegram: bash scripts/monitor.sh --setup"
        offsite_configured || echo "Копии вне сервера (зашифрованные, в облако): bash scripts/offsite.sh --setup"
        echo "Скачать копию к себе: на компьютере — download-backup.bat (двойной щелчок)"
        echo "  или вручную: scp -r root@$(curl -fsS -m 5 ifconfig.me 2>/dev/null || echo IP-сервера):$BACKUP_DIR/$(complete_backups | tail -n 1) ."
        ;;
    backup)
        do_backup
        ;;
esac
