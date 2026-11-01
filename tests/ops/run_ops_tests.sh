#!/usr/bin/env bash
# ============================================================================
# Проверка скриптов обслуживания VPS без Docker и без сервера:
# scripts/backup.sh, restore.sh, monitor.sh, vps_update.sh.
#
#   bash tests/ops/run_ops_tests.sh
#
# docker подменяется tests/ops/fake-bin/docker: команды compose выполняются
# на локальном PostgreSQL и в локальном sh. Telegram и /health/db —
# tests/ops/fake_services.py. Код приложения — одноразовый git-репозиторий
# во временном каталоге (снимок рабочей копии, с незакоммиченными правками):
# рабочая копия и её .git не трогаются.
#
# Нужны: PostgreSQL (пользователь marketplace — суперпользователь, как
# POSTGRES_USER в контейнере), python с backend/requirements.txt, git, curl,
# flock. Подключение: FAKE_PGHOST (сокет или хост; по умолчанию /tmp),
# FAKE_PGPORT, FAKE_PGPASSWORD, FAKE_PGTCP (хост для SQLAlchemy).
# KEEP_WORK=1 — не удалять временный каталог.
# ============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d /tmp/delo-ops-test.XXXXXX)"
APP="$WORK/app"
SRC="$WORK/src"
FAKE="$WORK/fake"
OUT="$WORK/out.txt"
DB=delo_ops_test
PGU=marketplace
export FAKE_PGHOST="${FAKE_PGHOST:-/tmp}" FAKE_PGPORT="${FAKE_PGPORT:-5432}" FAKE_PGPASSWORD="${FAKE_PGPASSWORD:-ci_password}"
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"

export BACKUP_DIR="$WORK/backups" STATE_DIR="$WORK/state" LOG_DIR="$WORK/log" \
    CRON_FILE="$WORK/cron.d/delo-marketplace" LOGROTATE_FILE="$WORK/logrotate.d/delo-marketplace" \
    TELEGRAM_API_URL="http://127.0.0.1:$PORT" \
    FAKE_DOCKER_STATE="$WORK/docker" FAKE_UPLOADS="$WORK/uploads" \
    PATH="$WORK/bin:$PATH"
mkdir -p "$WORK/cron.d" "$WORK/logrotate.d" "$FAKE_UPLOADS" "$FAKE" "$WORK/bin"
# Копия с правом на запуск: через API GitHub файлы попадают в репозиторий
# без бита исполнения.
cp "$REPO/tests/ops/fake-bin/"* "$WORK/bin/"
chmod +x "$WORK/bin/"*

PASS=0
FAIL=0
SECTION=""
FAILS="$WORK/failures.txt"
# В GitHub Actions журнал шага открыт не всем, а аннотации видны в PR и
# через API. Их не больше 10 на шаг, поэтому все непрошедшие проверки — в
# одной аннотации в конце: имя, раздел и (для первой в разделе) конец вывода.
ci_annotate() {
    [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
    local level="$1" msg="$2"
    msg="${msg//'%'/'%25'}"
    msg="${msg//$'\r'/}"
    msg="${msg//$'\n'/'%0A'}"
    echo "::$level title=ops tests::$msg"
}
out_tail() { [ -s "$OUT" ] && tail -n "${1:-25}" "$OUT"; }
pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
FAIL_SECTION=""
fail() {
    FAIL=$((FAIL + 1))
    echo "  ✗ $1"
    if [ -s "$OUT" ]; then sed 's/^/      | /' "$OUT" | tail -n 25; fi
    echo "✗ [$SECTION] $1" >> "$FAILS"
    [ "$FAIL_SECTION" = "$SECTION" ] || out_tail 12 | sed 's/^/    | /' >> "$FAILS"
    FAIL_SECTION="$SECTION"
}
expect() {
    local desc="$1"
    shift
    if "$@" > /dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}
expect_not() {
    local desc="$1"
    shift
    if "$@" > /dev/null 2>&1; then fail "$desc"; else pass "$desc"; fi
}
section() { SECTION="$1"; echo ""; echo "== $1"; }
has() { grep -qF -- "$1" "$OUT"; }

psql_() {
    PGHOST="$FAKE_PGHOST" PGPORT="$FAKE_PGPORT" PGPASSWORD="$FAKE_PGPASSWORD" \
        PGOPTIONS="--client-min-messages=warning" psql -X -q -v ON_ERROR_STOP=1 -U "$PGU" "$@"
}
q() { psql_ -d "$DB" -tAc "$1" 2> /dev/null; }
dbs_like() { psql_ -d postgres -tAc "SELECT datname FROM pg_database WHERE datname LIKE '$1' ORDER BY 1"; }
compose() { (cd "$APP" && docker compose -f docker-compose.prod.yml "$@"); }

# Запуск скрипта приложения: вывод — в $OUT, код — в RC. stdin не терминал.
RC=0
run() {
    local script="$1"
    shift
    (cd "$APP" && bash "scripts/$script" "$@") < /dev/null > "$OUT" 2>&1
    RC=$?
}

tg_texts() {
    [ -f "$FAKE/telegram.jsonl" ] || return 0
    python3 - "$FAKE/telegram.jsonl" << 'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    d = json.loads(line)
    if d.get("method") == "sendMessage":
        print(d.get("chat_id", ""), d.get("text", "").replace("\n", " "))
PY
}
tg_count() { tg_texts | grep -c . || true; }
tg_has() { tg_texts | grep -qF -- "$1"; }
tg_reset() { : > "$FAKE/telegram.jsonl"; }

env_line() { grep -E "^$1=" "$APP/.env" | tail -n 1 | cut -d= -f2-; }
env_put() {
    grep -vE "^$1=" "$APP/.env" > "$APP/.env.tmp" || true
    [ $# -lt 2 ] || echo "$1=$2" >> "$APP/.env.tmp"
    cat "$APP/.env.tmp" > "$APP/.env"
    rm -f "$APP/.env.tmp"
}

newest() { find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "$1" -printf '%f\n' 2> /dev/null | sort | tail -n 1; }

FAKE_PID=""
FINISHED=0
cleanup() {
    local rc=$?
    if [ "$FINISHED" = 1 ]; then
        [ "$FAIL" -eq 0 ] || sed -i "1i Итого: $PASS прошло, $FAIL не прошло" "$FAILS"
    else
        { echo "Проверка прервана в разделе «$SECTION» (код $rc)"; out_tail 25 | sed 's/^/    | /'; } >> "$FAILS"
    fi
    [ ! -s "$FAILS" ] || ci_annotate error "$(head -c 60000 "$FAILS")"
    [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2> /dev/null
    for d in $(dbs_like "${DB}%" 2> /dev/null) $(dbs_like 'delo_verify_%' 2> /dev/null); do
        psql_ -d postgres -c "DROP DATABASE IF EXISTS \"$d\"" > /dev/null 2>&1
    done
    if [ "${KEEP_WORK:-0}" = "1" ]; then echo "Временный каталог: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# --- Подготовка --------------------------------------------------------------

section "Подготовка"
python3 "$REPO/tests/ops/fake_services.py" "$PORT" "$FAKE" &
FAKE_PID=$!
for _ in $(seq 1 50); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health/db" 2> /dev/null && break; sleep 0.1; done

# На сервере pg_dump и pg_restore работают внутри контейнера postgres, то есть
# той же версии, что и база. Здесь так же: клиент более новой версии пишет
# в базу то, чего старая не знает (pg_restore 17+ в базу 15 — ошибка на
# SET transaction_timeout), более старой — не снимает копию с новой.
PG_SERVER_MAJOR=$(($(psql_ -d postgres -tAc 'SHOW server_version_num') / 10000))
pg_client_major() { pg_restore --version | awk '{ print $3 }' | cut -d. -f1; }
if [ "$(pg_client_major)" != "$PG_SERVER_MAJOR" ] && [ -x "/usr/lib/postgresql/$PG_SERVER_MAJOR/bin/pg_restore" ]; then
    export PATH="$WORK/bin:/usr/lib/postgresql/$PG_SERVER_MAJOR/bin:$PATH"
fi
if [ "$(pg_client_major)" != "$PG_SERVER_MAJOR" ]; then
    echo "Клиент PostgreSQL $(pg_client_major), а сервер $PG_SERVER_MAJOR: нужен клиент той же версии," \
        "как в контейнере (Ubuntu/Debian: postgresql-client-$PG_SERVER_MAJOR из apt.postgresql.org)." | tee "$OUT"
    exit 1
fi
ci_annotate notice "$(. /etc/os-release 2> /dev/null && echo "$PRETTY_NAME"); bash $BASH_VERSION; $(psql --version); \
сервер $(psql_ -d postgres -tAc 'SHOW server_version' 2>&1); $(pg_dump --version); $(git --version); \
$(script --version 2>&1 | head -n 1); $(python3 --version)"

# «GitHub»: репозиторий с историей C0 (снимок рабочей копии) -> C1.
git init -q -b main "$SRC"
git -C "$REPO" ls-files -co --exclude-standard -z \
    | tar -C "$REPO" --null --ignore-failed-read -T - -cf - 2> /dev/null | tar -C "$SRC" -xf -
gitc() { git -C "$SRC" -c user.name=ops-test -c user.email=ops@test.invalid "$@"; }
commit() { gitc add -A && gitc commit -q -m "$1" && git -C "$SRC" rev-parse HEAD; }
C0="$(commit "C0: снимок рабочей копии")"
echo c1 > "$SRC/OPS_TEST_VERSION"
C1="$(commit "C1: версия на сервере")"
git clone -q --bare "$SRC" "$WORK/origin.git"
push() { git -C "$SRC" push -q "$WORK/origin.git" main; }
# На сервере — неполный клон, как делает vps_deploy.sh.
git clone -q --depth 1 "file://$WORK/origin.git" "$APP"

cat > "$APP/.env" << ENV
ENV=production
SECRET_KEY=ops-test-not-a-secret
DOMAIN=
POSTGRES_USER=$PGU
POSTGRES_PASSWORD=$FAKE_PGPASSWORD
POSTGRES_DB=$DB
FRONTEND_URL=http://127.0.0.1
TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_BOT_TOKEN=111:alerts
ALERT_TELEGRAM_CHAT_ID=42
MONITOR_HEALTH_URL=http://127.0.0.1:$PORT/health/db
ENV
chmod 600 "$APP/.env"

psql_ -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" > /dev/null
compose up -d
compose run --rm --no-deps -T backend alembic upgrade head > "$OUT" 2>&1 || { cat "$OUT"; exit 1; }
(cd "$APP/backend" && ENV=development SECRET_KEY=ops-test-secret-key-0123456789abcdef0123 DEMO_PASSWORD=ops-demo-password \
    DATABASE_URL="postgresql+psycopg2://$PGU:$FAKE_PGPASSWORD@${FAKE_PGTCP:-localhost}:$FAKE_PGPORT/$DB" \
    python seed_demo.py) > "$OUT" 2>&1 || { tail -n 20 "$OUT"; exit 1; }
HEAD_REV="$(q "SELECT version_num FROM alembic_version")"
USERS="$(q "SELECT count(*) FROM users")"
mkdir -p "$FAKE_UPLOADS/avatars" "$FAKE_UPLOADS/tasks" "$FAKE_UPLOADS/portfolio"
head -c 2048 /dev/urandom > "$FAKE_UPLOADS/avatars/a.png"
echo "оригинал" > "$FAKE_UPLOADS/portfolio/p.txt"
echo "задание" > "$FAKE_UPLOADS/tasks/t1.txt"
echo "  база $DB: ревизия $HEAD_REV, пользователей $USERS; код C1 ${C1:0:7}"

# --- backup.sh ---------------------------------------------------------------

section "backup.sh: полная копия с проверкой восстановлением"
run backup.sh
expect "завершается успешно" [ "$RC" -eq 0 ]
B1="$(newest '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]')"
expect "каталог копии создан" [ -n "$B1" ]
for f in OK db.dump uploads.tar.gz env manifest.txt SHA256SUMS verify.txt; do
    expect "в копии есть $f" [ -s "$BACKUP_DIR/$B1/$f" ]
done
expect "копия .env с правами 600" [ "$(stat -c %a "$BACKUP_DIR/$B1/env")" = "600" ]
expect "каталог копий закрыт (700)" [ "$(stat -c %a "$BACKUP_DIR")" = "700" ]
expect "проверка восстановлением во временную базу прошла" grep -q "пробное восстановление: ок" "$BACKUP_DIR/$B1/verify.txt"
expect "манифест: ревизия схемы" grep -qx "alembic_revision=$HEAD_REV" "$BACKUP_DIR/$B1/manifest.txt"
expect "манифест: строки users до и после" grep -qx "rows_after.users=$USERS" "$BACKUP_DIR/$B1/manifest.txt"
expect "манифест: версия кода" grep -qx "git_commit=$C1" "$BACKUP_DIR/$B1/manifest.txt"
expect "архив файлов содержит avatars/a.png" sh -c "tar -tzf '$BACKUP_DIR/$B1/uploads.tar.gz' | grep -q 'avatars/a.png'"
expect "временная база проверки удалена" [ -z "$(dbs_like 'delo_verify_%')" ]
expect "last_status: ok" grep -q "^ok .* $B1\$" "$BACKUP_DIR/last_status"
expect "недособранных .partial нет" [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '*.partial')" ]

section "backup.sh: список и повторная проверка"
run backup.sh --list
expect "--list показывает копию" has "$B1"
run backup.sh --verify "$B1"
expect "--verify: копия в порядке" [ "$RC" -eq 0 ]
cp -a "$BACKUP_DIR/$B1" "$WORK/corrupt"
printf 'x' >> "$WORK/corrupt/db.dump"
run backup.sh --verify "$WORK/corrupt"
expect "--verify ловит изменённый файл" [ "$RC" -ne 0 ]
expect "  ...и говорит про контрольные суммы" has "контрольные суммы не сходятся"
# Дамп без последних байт, суммы пересчитаны (копию дописали не до конца,
# а SHA256SUMS сняли уже с неё): оглавление читается, данные — нет. Это
# ловит только проверка восстановлением.
rm -rf "$WORK/corrupt"
cp -a "$BACKUP_DIR/$B1" "$WORK/corrupt"
size="$(stat -c %s "$WORK/corrupt/db.dump")"
head -c $((size - 100)) "$BACKUP_DIR/$B1/db.dump" > "$WORK/corrupt/db.dump"
(cd "$WORK/corrupt" && sha256sum -- db.dump env manifest.txt uploads.tar.gz > SHA256SUMS)
run backup.sh --verify "$WORK/corrupt" --quick
expect "быстрая проверка обрезанный дамп не видит (оглавление цело)" [ "$RC" -eq 0 ]
run backup.sh --verify "$WORK/corrupt"
expect "проверка восстановлением ловит обрезанный дамп" [ "$RC" -ne 0 ] && has "пробное восстановление не удалось"
expect "временная база после неудачной проверки удалена" [ -z "$(dbs_like 'delo_verify_%')" ]
rm -rf "$WORK/corrupt"

section "backup.sh: копия перед обновлением (--db-only --quick --tag)"
run backup.sh --db-only --quick --tag pre-update-abc1234
expect "завершается успешно" [ "$RC" -eq 0 ]
BT="$(newest '*-pre-update-abc1234')"
expect "имя с меткой" [ -n "$BT" ]
expect "без файлов" [ ! -e "$BACKUP_DIR/$BT/uploads.tar.gz" ]
expect "manifest: kind=db-only" grep -qx "kind=db-only" "$BACKUP_DIR/$BT/manifest.txt"
expect "быстрая проверка отмечена" grep -q "не проверялось (--quick)" "$BACKUP_DIR/$BT/verify.txt"

section "backup.sh: сбой по расписанию -> уведомление"
tg_reset
FAKE_PGDUMP_FAIL=1 run backup.sh --cron
expect "завершается с ошибкой" [ "$RC" -ne 0 ]
expect "last_status: failed" grep -q "^failed " "$BACKUP_DIR/last_status"
expect "недособранная копия удалена" [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '*.partial')" ]
expect "уведомление в Telegram" tg_has "Резервная копия НЕ создана"
expect "  ...с причиной" tg_has "pg_dump"
expect "  ...в чат из ALERT_TELEGRAM_CHAT_ID" sh -c "grep -q '\"chat_id\": \"42\"' '$FAKE/telegram.jsonl'"

section "backup.sh: ночная копия ждёт окончания обновления"
echo "обновление (тест)" > "$STATE_DIR/maintenance"
run backup.sh --cron --db-only --quick
expect "ждёт, а не падает" [ "$RC" -eq 0 ] && has "жду окончания"
rm -f "$STATE_DIR/maintenance"

section "backup.sh: две копии подряд"
run backup.sh --db-only --quick --tag same
run backup.sh --db-only --quick --tag same
expect "вторая получает своё имя, а не вкладывается в первую" [ "$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-same' | wc -l)" -eq 2 ] && [ -z "$(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -type d -name '*-same*')" ]
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-same' -exec rm -rf {} +

section "backup.sh: одновременно — только одна"
(cd "$APP" && flock -n "$BACKUP_DIR/.lock" bash scripts/backup.sh) < /dev/null > "$OUT" 2>&1
RC=$?
expect "вторая копия отказывается" [ "$RC" -ne 0 ]
expect "  ...с понятной причиной" has "уже идёт"

section "backup.sh: хранение старых копий"
fake_backup() {
    mkdir -p "$BACKUP_DIR/$1"
    echo "kind=$2" > "$BACKUP_DIR/$1/manifest.txt"
    date -Iseconds > "$BACKUP_DIR/$1/OK"
}
for d in 01 02 03 04; do fake_backup "2020-01-${d}_000000" full; done
for d in 1 2 3 4 5 6; do fake_backup "2020-02-0${d}_000000-pre-update-old${d}" db-only; done
mkdir -p "$BACKUP_DIR/2020-03-01_000000.partial"
touch -d '3 days ago' "$BACKUP_DIR/2020-03-01_000000.partial"
run backup.sh --db-only --quick
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "старые обычные копии удалены" [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '2020-01-*')" ]
expect "свежая полная копия на месте" [ -f "$BACKUP_DIR/$B1/OK" ]
expect "помеченных осталось 5 (BACKUP_KEEP_TAGGED)" [ "$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-pre-*' | wc -l)" -eq 5 ]
expect "удалены самые старые помеченные" [ ! -d "$BACKUP_DIR/2020-02-01_000000-pre-update-old1" ] && [ ! -d "$BACKUP_DIR/2020-02-02_000000-pre-update-old2" ]
expect "остатки прерванных копий убраны" [ ! -d "$BACKUP_DIR/2020-03-01_000000.partial" ]
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2020-*' -exec rm -rf {} +

# --- restore.sh --------------------------------------------------------------

section "restore.sh: восстановление базы и файлов"
q "CREATE TABLE ops_marker (x int); INSERT INTO ops_marker VALUES (1); UPDATE users SET email = 'changed-' || email WHERE id = (SELECT min(id) FROM users)" > /dev/null
rm "$FAKE_UPLOADS/avatars/a.png"
echo "изменён" > "$FAKE_UPLOADS/portfolio/p.txt"
echo "новый" > "$FAKE_UPLOADS/after-backup.txt"
: > "$FAKE_DOCKER_STATE/redis.log"
run restore.sh "$B1" --yes
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "таблицы, созданной после копии, нет" [ -z "$(q "SELECT to_regclass('ops_marker')")" ]
expect "изменённые строки вернулись" [ "$(q "SELECT count(*) FROM users WHERE email LIKE 'changed-%'")" = "0" ]
expect "пользователей как в копии" [ "$(q "SELECT count(*) FROM users")" = "$USERS" ]
expect "удалённый файл вернулся" [ -f "$FAKE_UPLOADS/avatars/a.png" ]
expect "изменённый файл — как в копии" grep -qx "оригинал" "$FAKE_UPLOADS/portfolio/p.txt"
expect "файла, появившегося после копии, нет" [ ! -e "$FAKE_UPLOADS/after-backup.txt" ]
expect "служебные .previous/.restoring убраны" [ ! -e "$FAKE_UPLOADS/.previous" ] && [ ! -e "$FAKE_UPLOADS/.restoring" ]
expect "временная и прежняя базы удалены" [ -z "$(dbs_like "${DB}_%")" ]
PR="$(newest '*-pre-restore')"
expect "снята копия текущего состояния (pre-restore)" [ -n "$PR" ] && [ -f "$BACKUP_DIR/$PR/OK" ]
expect "  ...в ней изменения, сделанные после копии" grep -qx "rows_after.ops_marker=1" "$BACKUP_DIR/$PR/manifest.txt"
expect "подсказка, как вернуть как было" has "bash scripts/restore.sh $PR"
expect "сервисы запущены" [ -f "$FAKE_DOCKER_STATE/running/backend" ] && [ -f "$FAKE_DOCKER_STATE/running/worker" ]
expect "кэш Redis очищен" grep -q FLUSHALL "$FAKE_DOCKER_STATE/redis.log"
expect "сайт останавливался под флагом обслуживания" grep -q "^stop backend worker beat bot maint=yes" "$FAKE_DOCKER_STATE/stops.log"
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]

section "restore.sh: backend не поднялся -> всё возвращается"
q "CREATE TABLE ops_marker2 (x int)" > /dev/null
echo "x2" > "$FAKE_UPLOADS/x2.txt"
FAKE_HEALTH_FAIL=1 run restore.sh "$B1" --yes --no-safety-backup
expect "завершается с ошибкой" [ "$RC" -ne 0 ]
expect "база — как до восстановления" [ -n "$(q "SELECT to_regclass('ops_marker2')")" ]
expect "файлы — как до восстановления" [ -f "$FAKE_UPLOADS/x2.txt" ]
expect "служебные каталоги файлов убраны" [ ! -e "$FAKE_UPLOADS/.previous" ] && [ ! -e "$FAKE_UPLOADS/.restoring" ]
expect "неудачная база отложена для разбора" [ -n "$(dbs_like "${DB}_failed_restore_%")" ]
expect "временной и прежней баз не осталось" [ -z "$(dbs_like "${DB}_restoring")" ] && [ -z "$(dbs_like "${DB}_before_restore_%")" ]
expect "сайт запущен снова" [ -f "$FAKE_DOCKER_STATE/running/backend" ]
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]
for d in $(dbs_like "${DB}_failed_restore_%"); do psql_ -d postgres -c "DROP DATABASE \"$d\"" > /dev/null; done

section "restore.sh: копия со схемой новее кода — отказ"
cp -a "$BACKUP_DIR/$B1" "$WORK/future"
sed -i "s/^alembic_revision=.*/alembic_revision=ffffffffffff/" "$WORK/future/manifest.txt"
(cd "$WORK/future" && sha256sum -- db.dump env manifest.txt uploads.tar.gz > SHA256SUMS)
run restore.sh "$WORK/future" --yes
expect "отказывается" [ "$RC" -ne 0 ]
expect "  ...и объясняет" has "новее текущего кода"
expect "база не тронута" [ -n "$(q "SELECT to_regclass('ops_marker2')")" ]
rm "$WORK/future/OK"
run restore.sh "$WORK/future" --yes
expect "копию без OK не восстанавливает" [ "$RC" -ne 0 ] && has "нет файла OK"
rm -rf "$WORK/future"
q "DROP TABLE ops_marker2" > /dev/null
rm -f "$FAKE_UPLOADS/x2.txt"

# --- backup.sh --install и monitor.sh ----------------------------------------

section "backup.sh --install: расписание и первая копия"
run backup.sh --install
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "в расписании ночная копия" grep -q "30 0 \* \* \* root bash $APP/scripts/backup.sh --cron" "$CRON_FILE"
expect "в расписании мониторинг" grep -q "\*/5 \* \* \* \* root bash $APP/scripts/monitor.sh --cron" "$CRON_FILE"
expect "ротация журналов" grep -q "delo-monitor.log" "$LOGROTATE_FILE"

section "monitor.sh: всё в порядке"
run monitor.sh
expect "итог без проблем (код 0)" [ "$RC" -eq 0 ]
expect "сайт ✓" has "✓ сайт"
expect "контейнеры ✓" has "✓ контейнеры"
expect "диск ✓" has "✓ диск"
expect "копии ✓" has "✓ копии"
expect "сертификат пропущен (нет домена)" has "· сертификат"
tg_reset
run monitor.sh --cron
expect "по расписанию: тишина" [ "$(tg_count)" -eq 0 ]
expect "отметка о запуске" [ -s "$STATE_DIR/monitor/last_run" ]

section "monitor.sh: упал воркер"
compose stop worker
run monitor.sh --cron
expect "первая неудача — без уведомления" [ "$(tg_count)" -eq 0 ]
run monitor.sh --cron
expect "вторая подряд — уведомление" [ "$(tg_count)" -eq 1 ] && tg_has "worker (exited"
run monitor.sh --cron
expect "без повторов" [ "$(tg_count)" -eq 1 ]
run monitor.sh
expect "--status показывает проблему (код 1)" [ "$RC" -eq 1 ] && has "✗ контейнеры"
read -r f s _ < "$STATE_DIR/monitor/containers"
printf '%s %s %s\n%s\n' "$f" "$s" "$(( $(date +%s) - 7 * 3600 ))" "x" > "$STATE_DIR/monitor/containers"
run monitor.sh --cron
expect "через 6 часов — напоминание" [ "$(tg_count)" -eq 2 ] && tg_has "Всё ещё не решено"
compose up -d worker
run monitor.sh --cron
expect "поднялся — сообщение о восстановлении" [ "$(tg_count)" -eq 3 ] && tg_has "Снова в порядке — контейнеры"
expect "состояние очищено" [ ! -e "$STATE_DIR/monitor/containers" ]

section "monitor.sh: сайт отвечает 503"
tg_reset
echo 503 > "$FAKE/health_code"
run monitor.sh --cron
run monitor.sh --cron
expect "уведомление после двух неудач" [ "$(tg_count)" -eq 1 ] && tg_has "HTTP 503"
echo 200 > "$FAKE/health_code"
run monitor.sh --cron
expect "восстановление" [ "$(tg_count)" -eq 2 ] && tg_has "Снова в порядке — сайт"

section "monitor.sh: диск и копии"
tg_reset
env_put MONITOR_DISK_PERCENT 1
run monitor.sh --cron
expect "диск: сразу уведомление" [ "$(tg_count)" -eq 1 ] && tg_has "Заканчивается место на диске"
env_put MONITOR_DISK_PERCENT
run monitor.sh --cron
expect "диск: восстановление" [ "$(tg_count)" -eq 2 ]
tg_reset
for d in "$BACKUP_DIR"/*/OK; do touch -d '30 hours ago' "$d"; done
run monitor.sh --cron
expect "копии старше 26 часов — уведомление" [ "$(tg_count)" -eq 1 ] && tg_has "Резервные копии не обновляются"
for d in "$BACKUP_DIR"/*/OK; do touch "$d"; done
run monitor.sh --cron
expect "копии: восстановление" [ "$(tg_count)" -eq 2 ]

section "monitor.sh: обслуживание, недоставка, без Telegram"
tg_reset
echo "обновление (тест)" > "$STATE_DIR/maintenance"
compose stop worker
run monitor.sh --cron
run monitor.sh --cron
expect "во время обновления — молчит" [ "$(tg_count)" -eq 0 ]
touch -d '2 hours ago' "$STATE_DIR/maintenance"
run monitor.sh --cron
run monitor.sh --cron
expect "забытый флаг обслуживания не глушит проверки" [ "$(tg_count)" -eq 1 ]
rm -f "$STATE_DIR/maintenance" "$STATE_DIR/monitor/containers"
tg_reset
export TELEGRAM_API_URL="http://127.0.0.1:9"
run monitor.sh --cron
run monitor.sh --cron
expect "Telegram недоступен — уведомление не считается отправленным" grep -q '^[0-9]* [0-9]* 0$' "$STATE_DIR/monitor/containers"
export TELEGRAM_API_URL="http://127.0.0.1:$PORT"
run monitor.sh --cron
expect "  ...и уходит при следующей проверке" [ "$(tg_count)" -eq 1 ]
compose up -d worker
run monitor.sh --cron
tg_reset
env_put ALERT_TELEGRAM_CHAT_ID
compose stop worker
run monitor.sh --cron
run monitor.sh --cron
expect "без Telegram — строка в журнале, без сбоя" [ "$RC" -eq 0 ] && has "Telegram не настроен" && [ "$(tg_count)" -eq 0 ]
compose up -d worker
run monitor.sh --cron
rm -f "$STATE_DIR/monitor/containers"

section "monitor.sh --setup и --test"
tg_reset
env_put ALERT_TELEGRAM_BOT_TOKEN
env_put ALERT_TELEGRAM_CHAT_ID
(cd "$APP" && printf '222:newbot\n\n' | bash scripts/monitor.sh --setup) > "$OUT" 2>&1
RC=$?
expect "отдельный бот: настройка проходит" [ "$RC" -eq 0 ]
expect "  ...токен сохранён" [ "$(env_line ALERT_TELEGRAM_BOT_TOKEN)" = "222:newbot" ]
expect "  ...чат найден через getUpdates" [ "$(env_line ALERT_TELEGRAM_CHAT_ID)" = "987654321" ]
expect "  ...пробное сообщение отправлено" tg_has "987654321 [ДЕЛО"
expect "  ...токен не напечатан" sh -c "! grep -q '222:newbot' '$OUT'"
expect ".env по-прежнему 600" [ "$(stat -c %a "$APP/.env")" = "600" ]
run monitor.sh --test
expect "--test отправляет сообщение" [ "$RC" -eq 0 ] && tg_has "Проверка уведомлений"
(cd "$APP" && printf 'y\nbad\n' | bash scripts/monitor.sh --setup) > "$OUT" 2>&1
RC=$?
expect "неверный токен — отказ с причиной" [ "$RC" -ne 0 ] && has "Unauthorized"
tg_reset
: > "$FAKE/telegram.jsonl"
env_put ALERT_TELEGRAM_BOT_TOKEN
env_put ALERT_TELEGRAM_CHAT_ID
env_put TELEGRAM_BOT_TOKEN 333:service
(cd "$APP" && printf '\n555\n' | bash scripts/monitor.sh --setup) > "$OUT" 2>&1
RC=$?
expect "бот сайта: настройка проходит" [ "$RC" -eq 0 ]
expect "  ...id чата введён вручную" [ "$(env_line ALERT_TELEGRAM_CHAT_ID)" = "555" ]
expect "  ...сообщения у работающего бота не отнимаются (нет getUpdates)" sh -c "! grep -q getUpdates '$FAKE/telegram.jsonl'"
expect "  ...сообщение ушло от бота сайта" grep -q '"token": "333:service", "method": "sendMessage"' "$FAKE/telegram.jsonl"
env_put TELEGRAM_BOT_TOKEN ""
env_put ALERT_TELEGRAM_BOT_TOKEN 111:alerts
env_put ALERT_TELEGRAM_CHAT_ID 42

# --- vps_update.sh -----------------------------------------------------------

section "vps_update.sh: обновление"
echo "c2" > "$SRC/OPS_TEST_VERSION"
C2="$(commit "C2: новая версия")"
push
: > "$FAKE_DOCKER_STATE/builds.log"
run vps_update.sh
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "код — C2" [ "$(git -C "$APP" rev-parse HEAD)" = "$C2" ]
PU="$(newest "*-pre-update-${C1:0:7}")"
expect "копия базы перед обновлением" [ -n "$PU" ] && [ -f "$BACKUP_DIR/$PU/OK" ]
expect "журнал: прежняя версия и новая" grep -q " $C1 ok " "$STATE_DIR/deploy-history" && grep -q " $C2 ok " "$STATE_DIR/deploy-history"
expect "сборка шла под флагом обслуживания" grep -q "maint=yes" "$FAKE_DOCKER_STATE/builds.log"
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]
expect "подсказка про откат на C1" has "--rollback   (вернёт ${C1:0:7})"
run vps_update.sh --history
expect "--history показывает журнал" has "${C2:0:7}" && has "${C1:0:7}"

section "vps_update.sh --rollback"
run vps_update.sh --rollback
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "код — C1" [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]
expect "показывает, на что откатывает" has "Откат на: ${C1:0:7}"
expect "журнал: C1 ok последним" [ "$(tail -n 1 "$STATE_DIR/deploy-history" | cut -d' ' -f2,3)" = "$C1 ok" ]

section "vps_update.sh: сборка упала -> код возвращается"
FAKE_BUILD_FAIL=1 run vps_update.sh
expect "завершается с ошибкой" [ "$RC" -ne 0 ]
expect "код вернулся на C1" [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]
expect "в журнале — сбой C2" [ "$(tail -n 1 "$STATE_DIR/deploy-history" | cut -d' ' -f2,3)" = "$C2 failed" ]
expect "объясняет, что сайт не тронут" has "сайт работает на прежней версии"
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]

section "vps_update.sh: копия базы не снялась -> обновление отменено"
FAKE_PGDUMP_FAIL=1 run vps_update.sh
expect "завершается с ошибкой" [ "$RC" -ne 0 ] && has "обновление отменено"
expect "код не тронут" [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]

section "vps_update.sh: новая версия не поднялась -> прежняя возвращается"
FAKE_HEALTH_FAIL_AT="$C2" run vps_update.sh
expect "завершается с ошибкой" [ "$RC" -ne 0 ]
expect "без терминала (deploy.bat) C1 возвращается сама" [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]
expect "  ...журнал: C2 — сбой, C1 снова поднялась" \
    [ "$(tail -n 2 "$STATE_DIR/deploy-history" | cut -d' ' -f2,3 | paste -sd' ')" = "$C2 failed $C1 ok" ]
expect "  ...и прямо говорит, что обновление не удалось" has "Обновление НЕ удалось"
expect_not "  ...и не предлагает «откат» на сломанную C2" has "(вернёт ${C2:0:7})"
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]
in_tty() { (cd "$APP" && printf '%s' "$1" | script -qec "bash scripts/vps_update.sh" /dev/null) > "$OUT" 2>&1; }
if command -v script > /dev/null 2>&1; then
    FAKE_HEALTH_FAIL_AT="$C2" in_tty $'n\n'
    expect "в терминале: «Вернуть прежнюю?» -> нет -> остаётся C2" [ "$(git -C "$APP" rev-parse HEAD)" = "$C2" ]
    expect "  ...подсказывает команду возврата" has "bash scripts/vps_update.sh ${C1:0:7}"
    run vps_update.sh --rollback
    expect "--rollback возвращает C1" [ "$RC" -eq 0 ] && [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]
    FAKE_HEALTH_FAIL_AT="$C2" in_tty $'\n'
    expect "в терминале: Enter (по умолчанию «да») -> C1" [ "$(git -C "$APP" rev-parse HEAD)" = "$C1" ]
    expect "  ...C1 записана в журнал как рабочая" [ "$(tail -n 1 "$STATE_DIR/deploy-history" | cut -d' ' -f2,3)" = "$C1 ok" ]
else
    fail "нет утилиты script (util-linux) — сценарии с терминалом не проверены"
fi

section "vps_update.sh: обновился сам скрипт -> продолжает новая версия"
echo 'echo "НОВАЯ-ВЕРСИЯ-СКРИПТА"' >> "$SRC/scripts/vps_update.sh"
C3="$(commit "C3: правка vps_update.sh")"
push
run vps_update.sh
expect "завершается успешно" [ "$RC" -eq 0 ]
expect "передаёт работу новой версии" has "продолжаю его новой версией"
expect "новая версия дошла до конца" has "НОВАЯ-ВЕРСИЯ-СКРИПТА"
expect "C3 в журнале один раз" [ "$(grep -c " $C3 ok " "$STATE_DIR/deploy-history")" -eq 1 ]
expect "флаг обслуживания снят" [ ! -e "$STATE_DIR/maintenance" ]

section "vps_update.sh: миграция и откат через неё"
MIG="$SRC/backend/migrations/versions/f0e1d2c3b4a5_ops_test_marker.py"
cat > "$MIG" << PY
"""ops test marker"""
from alembic import op
import sqlalchemy as sa

revision = 'f0e1d2c3b4a5'
down_revision = '$HEAD_REV'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('ops_update_marker', sa.Column('id', sa.Integer, primary_key=True))


def downgrade():
    op.drop_table('ops_update_marker')
PY
C4="$(commit "C4: миграция")"
push
run vps_update.sh
expect "обновление с миграцией проходит" [ "$RC" -eq 0 ]
expect "миграция применена" [ "$(q "SELECT version_num FROM alembic_version")" = "f0e1d2c3b4a5" ]
run vps_update.sh --rollback
expect "откат на версию без миграции проходит" [ "$RC" -eq 0 ] && [ "$(git -C "$APP" rev-parse HEAD)" = "$C3" ]
expect "  ...миграции пропущены с объяснением" has "схема базы (f0e1d2c3b4a5) новее этой версии кода"
expect "  ...подсказывает копию той же версии" has "pre-update-${C3:0:7}"
run restore.sh "$(newest "*-pre-update-${C3:0:7}")" --yes --db-only
expect "restore.sh возвращает базу версии C3" [ "$RC" -eq 0 ] && [ "$(q "SELECT version_num FROM alembic_version")" = "$HEAD_REV" ]

section "vps_update.sh: не поднялась ни новая версия, ни прежняя"
(cd "$APP" && FAKE_HEALTH_FAIL=1 timeout 300 bash scripts/vps_update.sh) < /dev/null > "$OUT" 2>&1
RC=$?
expect "завершается с ошибкой, без зацикливания" [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ]
expect "возврат пробовался один раз" [ "$(grep -c 'Возвращаю прежнюю версию' "$OUT")" -eq 1 ]
expect "код — прежняя версия C3" [ "$(git -C "$APP" rev-parse HEAD)" = "$C3" ]
PU="$(newest "*-pre-update-${C3:0:7}")"
expect "объясняет про схему и даёт команду восстановления" \
    has "тоже не запустилась" && has "bash scripts/restore.sh $PU --db-only"
run restore.sh "$PU" --yes --db-only
expect "по этой команде C3 поднимается на своей базе" \
    [ "$RC" -eq 0 ] && [ "$(q "SELECT version_num FROM alembic_version")" = "$HEAD_REV" ]

section "vps_update.sh: версия по короткому хешу из неполного клона"
expect "C0 в клоне нет (клон --depth 1)" sh -c "! git -C '$APP' cat-file -e '$C0^{commit}' 2>/dev/null"
run vps_update.sh "${C0:0:9}"
expect "догружает историю и переходит на C0" [ "$RC" -eq 0 ] && [ "$(git -C "$APP" rev-parse HEAD)" = "$C0" ]
run vps_update.sh nonexistent-ref
expect "неизвестная версия — понятный отказ" [ "$RC" -ne 0 ] && has "не найдена"

section "vps_update.sh: ручные правки и параллельный запуск"
echo "правка на сервере" >> "$APP/README.md"
run vps_update.sh
expect "обновление проходит" [ "$RC" -eq 0 ] && [ "$(git -C "$APP" rev-parse HEAD)" = "$C4" ]
PATCH="$(find "$STATE_DIR" -name 'local-changes-*.patch' | head -n 1)"
expect "ручные правки сохранены в патч" [ -n "$PATCH" ] && grep -q "правка на сервере" "$PATCH"
(cd "$APP" && flock -n "$STATE_DIR/update.lock" bash scripts/vps_update.sh) < /dev/null > "$OUT" 2>&1
RC=$?
expect "второй запуск одновременно — отказ" [ "$RC" -ne 0 ] && has "обновление уже идёт"

echo ""
echo "Итого: $PASS прошло, $FAIL не прошло"
FINISHED=1
[ "$FAIL" -eq 0 ]
