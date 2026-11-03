#!/usr/bin/env bash
# ============================================================================
# Копии «ДЕЛО» вне сервера: зашифрованная выгрузка в облачное хранилище S3
# (Yandex Object Storage, Selectel, VK Cloud или другое совместимое с S3).
#
#   bash scripts/offsite.sh --setup      подключить хранилище (один раз)
#   bash scripts/offsite.sh              выгрузить последнюю копию сейчас
#   bash scripts/offsite.sh --list       что лежит в хранилище
#   bash scripts/offsite.sh --get ИМЯ    скачать копию из хранилища на сервер
#                                        и проверить (latest — последнюю)
#   bash scripts/offsite.sh --test       проверить доступ к хранилищу
#
# Зачем. Копии scripts/backup.sh лежат на том же сервере: от неудачного
# обновления они спасают, от потери сервера (сбой у хостера, взлом,
# неоплата) — нет. После --setup каждая полная копия — ночная и сделанная
# вручную — сразу выгружается в хранилище другого провайдера. Копии с меткой
# (перед обновлением, перед восстановлением) и «только база» не выгружаются.
#
# Шифрование — здесь же, до отправки: openssl, AES-256, ключ из фразы
# BACKUP_ENCRYPTION_PASSPHRASE (PBKDF2, 200 000 итераций). Хранилище видит
# только шифр. Без фразы копию не прочитать никому, в том числе вам: храните
# её вне сервера (менеджер паролей). --setup покажет её один раз.
#
# На каждую копию в хранилище два объекта: ПРЕФИКС/ИМЯ.tar.enc (каталог
# копии, зашифрованный) и ПРЕФИКС/ИМЯ.tar.enc.sha256 (контрольная сумма).
# Хранятся BACKUP_OFFSITE_KEEP_DAYS дней (по умолчанию 30), три последние —
# всегда; 0 — скрипт ничего не удаляет (срок задан правилом в хранилище).
#
# Итог последней выгрузки — $BACKUP_DIR/offsite_status. scripts/monitor.sh
# пришлёт уведомление, если выгрузка не удалась.
#
# Настройки в .env (их записывает --setup):
#   BACKUP_S3_ENDPOINT  BACKUP_S3_REGION  BACKUP_S3_BUCKET  BACKUP_S3_PREFIX
#   BACKUP_S3_ACCESS_KEY  BACKUP_S3_SECRET_KEY  BACKUP_ENCRYPTION_PASSPHRASE
#   BACKUP_OFFSITE_KEEP_DAYS
#
# Служебное: --push ИМЯ — выгрузить эту копию (так вызывает backup.sh).
# ============================================================================
set -Eeuo pipefail

# shellcheck source=scripts/ops_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/ops_common.sh"
cd "$APP_DIR"

usage() { sed -n '3,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

MODE=push
TARGET=latest
while [ $# -gt 0 ]; do
    case "$1" in
        --setup) MODE=setup ;;
        --push)
            MODE=push
            if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then TARGET="$2"; shift; fi ;;
        --list) MODE=list ;;
        --get)
            [ $# -ge 2 ] || die "укажите копию: bash scripts/offsite.sh --get ИМЯ (latest — последняя; список: --list)"
            MODE="get"; TARGET="$2"; shift ;;
        --test) MODE="test" ;;
        -h|--help) usage; exit 0 ;;
        *) die "неизвестный аргумент: $1 (справка: bash scripts/offsite.sh --help)" ;;
    esac
    shift
done

S3_CLIENT="$APP_DIR/scripts/offsite_s3.py"
NAME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}(-[A-Za-z0-9._-]+)?$'
# Сколько последних копий в хранилище не удаляется никогда.
KEEP_MIN=3
# Параметры шифрования. Не менять: ими же расшифровываются копии, выгруженные
# раньше.
CIPHER=(-aes-256-cbc -md sha256 -pbkdf2 -iter 200000)
# Фраза, которую можно ввести самому: без пробелов, кавычек, `$` и `;` — .env
# читает ещё и docker compose, а vps_deploy.sh загружает его как shell-скрипт
# (`. ./.env`): после `;` остаток строки выполнился бы как команда.
PASS_RE='^[A-Za-z0-9._,:!?@%+=*~^/-]{12,}$'

# --- Настройки ---------------------------------------------------------------

strip_slashes() {
    local p="$1"
    while [ "${p#/}" != "$p" ]; do p="${p#/}"; done
    while [ "${p%/}" != "$p" ]; do p="${p%/}"; done
    printf '%s' "$p"
}

load_config() {
    S3_ENDPOINT="$(env_get BACKUP_S3_ENDPOINT)"
    S3_REGION="$(env_get BACKUP_S3_REGION us-east-1)"
    S3_BUCKET="$(env_get BACKUP_S3_BUCKET)"
    S3_ACCESS_KEY="$(env_get BACKUP_S3_ACCESS_KEY)"
    S3_SECRET_KEY="$(env_get BACKUP_S3_SECRET_KEY)"
    PREFIX="$(strip_slashes "$(env_get BACKUP_S3_PREFIX delo)")"
    PASSPHRASE="$(env_get BACKUP_ENCRYPTION_PASSPHRASE)"
    KEEP_DAYS="$(env_get BACKUP_OFFSITE_KEEP_DAYS 30)"
    [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || KEEP_DAYS=30
}

require_config() {
    local missing=""
    load_config
    [ -n "$S3_ENDPOINT" ] || missing+=" BACKUP_S3_ENDPOINT"
    [ -n "$S3_BUCKET" ] || missing+=" BACKUP_S3_BUCKET"
    [ -n "$S3_ACCESS_KEY" ] || missing+=" BACKUP_S3_ACCESS_KEY"
    [ -n "$S3_SECRET_KEY" ] || missing+=" BACKUP_S3_SECRET_KEY"
    if [ -n "$missing" ]; then
        offsite_configured && die "в .env не заданы:$missing — bash scripts/offsite.sh --setup"
        die "хранилище не настроено: bash scripts/offsite.sh --setup"
    fi
}

require_passphrase() {
    [ -n "$PASSPHRASE" ] || die "в .env нет BACKUP_ENCRYPTION_PASSPHRASE — фразы, которой шифруются копии (bash scripts/offsite.sh --setup)"
}

require_tools() {
    local t
    for t in python3 openssl tar sha256sum flock cmp; do
        command -v "$t" > /dev/null 2>&1 || die "нет программы $t (apt-get install -y python3 openssl)"
    done
    openssl enc -aes-256-cbc -pbkdf2 -iter 1 -pass pass:probe -in /dev/null -out /dev/null 2> /dev/null \
        || die "openssl на сервере слишком старый: нужен 1.1.1 или новее (apt-get install -y openssl)"
}

where() { printf '%s%s (%s)' "$S3_BUCKET" "${PREFIX:+/$PREFIX}" "$S3_ENDPOINT"; }
key_for() { printf '%s%s.tar.enc' "${PREFIX:+$PREFIX/}" "$1"; }

# --- Хранилище ---------------------------------------------------------------

# Ключи — через окружение, не аргументами: командную строку видят все
# пользователи сервера (ps). Ошибку клиент пишет в stderr: вызывающие
# перенаправляют её в ERR_FILE и показывают через s3_error.
s3() {
    S3_ENDPOINT="$S3_ENDPOINT" S3_REGION="$S3_REGION" S3_BUCKET="$S3_BUCKET" \
        S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" \
        python3 "$S3_CLIENT" "$@"
}

ERR_FILE=""
s3_error() { tr '\n' ' ' < "$ERR_FILE" | sed 's/[[:space:]]*$//'; }

# Копии в хранилище, от старых к новым: «ИМЯ<TAB>РАЗМЕР<TAB>ДАТА».
remote_backups() {
    local listing key size modified base
    listing="$(s3 list "${PREFIX:+$PREFIX/}")" || return 1
    while IFS=$'\t' read -r key size modified; do
        base="${key#"${PREFIX:+$PREFIX/}"}"
        case "$base" in
            */*) continue ;;
            *.tar.enc) base="${base%.tar.enc}" ;;
            *) continue ;;
        esac
        [[ "$base" =~ $NAME_RE ]] || continue
        printf '%s\t%s\t%s\n' "$base" "$size" "$modified"
    done <<< "$listing" | sort
}

# Пробный объект: запись, чтение, список, удаление. Код: 0 — всё можно;
# 1 — не работает запись, чтение или список; 2 — нельзя только удалять.
probe() {
    local key tmp
    key="${PREFIX:+$PREFIX/}.offsite-probe"
    tmp="$(mktemp)"
    TMP_PATHS+=("$tmp" "$tmp.got")
    printf 'ДЕЛО: проверка доступа %s\n' "$(date -Iseconds)" > "$tmp"
    if ! s3 put "$tmp" "$key" 2> "$ERR_FILE"; then
        echo "  ✗ запись: $(s3_error)"
        return 1
    fi
    echo "  ✓ запись"
    if ! s3 get "$key" "$tmp.got" 2> "$ERR_FILE" || ! cmp -s "$tmp" "$tmp.got"; then
        echo "  ✗ чтение: $(s3_error)"
        return 1
    fi
    echo "  ✓ чтение"
    if ! s3 list "${PREFIX:+$PREFIX/}" > /dev/null 2> "$ERR_FILE"; then
        echo "  ✗ список объектов: $(s3_error)"
        return 1
    fi
    echo "  ✓ список объектов"
    if ! s3 delete "$key" 2> "$ERR_FILE"; then
        echo "  ✗ удаление: $(s3_error)"
        return 2
    fi
    echo "  ✓ удаление"
    return 0
}

# --- Служебное ---------------------------------------------------------------

TMP_PATHS=()
PUSHING=""
FAIL_REASON=""
CREATED_ENV=0

on_exit() {
    local code=$? p reason
    for p in "${TMP_PATHS[@]}"; do rm -rf -- "$p"; done
    [ -z "$ERR_FILE" ] || rm -f -- "$ERR_FILE"
    # Неудачная --setup на новом сервере не оставляет .env-заготовку:
    # vps_deploy.sh принял бы её за настоящий .env.
    if [ "$CREATED_ENV" = 1 ] && [ "$code" -ne 0 ]; then
        rm -f -- "$APP_DIR/.env"
    fi
    if [ -n "$PUSHING" ] && [ "$code" -ne 0 ]; then
        reason="${FAIL_REASON:-код $code}"
        [ "$code" -ne 130 ] || reason="выгрузка прервана"
        printf 'failed %s %s: %s\n' "$(date +%s)" "$PUSHING" "$reason" > "$BACKUP_DIR/offsite_status" 2> /dev/null || true
    fi
}
trap on_exit EXIT
trap 'FAIL_REASON="${FAIL_REASON:-строка $LINENO: $BASH_COMMAND}"' ERR
ERR_FILE="$(mktemp)"

# Одновременно с копией или восстановлением нельзя: backup.sh мог бы удалить
# выгружаемую копию, а --get — помешать restore.sh. backup.sh держит замок
# сам и выгружает копию с DELO_BACKUP_LOCK_HELD=1.
take_lock() {
    [ -z "${DELO_BACKUP_LOCK_HELD:-}" ] || return 0
    mkdir -p "$BACKUP_DIR"
    exec 9> "$BACKUP_DIR/.lock"
    flock -n 9 || die "идёт резервная копия или восстановление — повторите позже"
}

# ask ПЕРЕМЕННАЯ "Вопрос" [по умолчанию] — ответ без пробелов по краям.
# Код 1 — ввод закончился (EOF), ничего не прочитано.
ask() {
    local __var="$1" __prompt="$2" __default="${3:-}" __answer="" __rc=0
    [ -z "$__default" ] || __prompt="$__prompt [$__default]"
    IFS= read -r -p "$__prompt: " __answer || __rc=$?
    __answer="$(printf '%s' "$__answer" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$__answer" ] || __answer="$__default"
    printf -v "$__var" '%s' "$__answer"
    [ "$__rc" -eq 0 ] || [ -n "$__answer" ]
}

# ask_secret ПЕРЕМЕННАЯ "Вопрос" — без отображения ввода.
ask_secret() {
    local __var="$1" __answer="" __rc=0
    IFS= read -rs -p "$2: " __answer || __rc=$?
    [ ! -t 0 ] || echo "" >&2
    __answer="$(printf '%s' "$__answer" | tr -d '\r\n')"
    printf -v "$__var" '%s' "$__answer"
    [ "$__rc" -eq 0 ] || [ -n "$__answer" ]
}

yes_answer() {
    case "$1" in да | Да | ДА | д | Д | yes | Yes | YES | y | Y) return 0 ;; esac
    return 1
}

# --- Выгрузка ----------------------------------------------------------------

do_push() {
    local name dir key tmp size need free enc_size sum remote started
    require_config
    require_passphrase
    require_tools
    take_lock
    if [ "$TARGET" = "latest" ]; then
        name="$(latest_full_backup)"
        if [ -z "$name" ]; then
            log "Выгружать нечего: готовых полных копий в $BACKUP_DIR нет (сделать: bash scripts/backup.sh)"
            return 0
        fi
    else
        name="$(basename "$TARGET")"
    fi
    dir="$BACKUP_DIR/$name"
    { [[ "$name" =~ $NAME_RE ]] && [ -d "$dir" ]; } || die "копия не найдена: $TARGET (список: bash scripts/backup.sh --list)"
    [ -f "$dir/OK" ] || die "копия $name не готова или не прошла проверку (нет файла OK)"

    PUSHING="$name"
    started="$(date +%s)"
    key="$(key_for "$name")"
    log "Выгрузка $name в хранилище $(where)"

    size="$(du -sb "$dir" | cut -f1)"
    need=$((size + 16 * 1024 * 1024))
    free="$(free_bytes "$BACKUP_DIR")"
    [ "${free:-0}" -ge "$need" ] || die "мало места для шифрования: свободно $(human_size "${free:-0}"), нужно ~$(human_size "$need")"

    # Шифр — рядом с копиями (каталог закрыт, 700), а не в /tmp: там бывает
    # tmpfs размером с половину памяти.
    tmp="$BACKUP_DIR/.offsite-$name.tar.enc"
    rm -f -- "$tmp" "$tmp.sha256"
    TMP_PATHS+=("$tmp" "$tmp.sha256")
    log "    шифрую ($(human_size "$size"))"
    if ! tar -C "$BACKUP_DIR" -cf - "$name" 2> "$ERR_FILE" \
        | DELO_OFFSITE_PASS="$PASSPHRASE" openssl enc -e "${CIPHER[@]}" -salt -pass env:DELO_OFFSITE_PASS \
            -out "$tmp" 2>> "$ERR_FILE"; then
        die "не удалось упаковать и зашифровать: $(s3_error)"
    fi
    enc_size="$(stat -c %s "$tmp")"
    sum="$(sha256sum "$tmp" | cut -d' ' -f1)"
    printf '%s  %s\n' "$sum" "$name.tar.enc" > "$tmp.sha256"

    log "    отправляю $(human_size "$enc_size")"
    s3 put "$tmp" "$key" 2> "$ERR_FILE" || die "не удалось отправить: $(s3_error)"
    s3 put "$tmp.sha256" "$key.sha256" 2> "$ERR_FILE" || die "не удалось отправить контрольную сумму: $(s3_error)"
    remote="$(s3 head "$key" 2> "$ERR_FILE")" || die "не удалось проверить отправленное: $(s3_error)"
    [ "$remote" = "$enc_size" ] || die "в хранилище $remote байт, а отправлено $enc_size"
    rm -f -- "$tmp" "$tmp.sha256"

    printf 'ok %s %s\n' "$(date +%s)" "$name" > "$BACKUP_DIR/offsite_status"
    # Что уже выгружено — для мониторинга: свежая копия без отметки здесь
    # значит, что выгрузка не дошла до конца.
    printf '%s %s\n' "$name" "$(date +%s)" >> "$BACKUP_DIR/offsite_uploaded"
    tail -n 200 "$BACKUP_DIR/offsite_uploaded" > "$BACKUP_DIR/offsite_uploaded.tmp"
    mv -f -- "$BACKUP_DIR/offsite_uploaded.tmp" "$BACKUP_DIR/offsite_uploaded"
    PUSHING=""
    log "    выгружено: $key ($(human_size "$enc_size"), $(( $(date +%s) - started )) с)"

    prune_remote
}

# Старые копии в хранилище: по сроку, кроме KEEP_MIN последних. Сбой здесь
# выгрузку не отменяет — она уже прошла.
prune_remote() {
    local names keep cutoff n
    if [ "$KEEP_DAYS" = "0" ]; then
        log "    старые копии в хранилище скрипт не удаляет (BACKUP_OFFSITE_KEEP_DAYS=0)"
        return 0
    fi
    if ! names="$(remote_backups 2> "$ERR_FILE" | cut -f1)"; then
        log "    ВНИМАНИЕ: список копий в хранилище не получен, старые не удалены: $(s3_error)"
        return 0
    fi
    keep="$(tail -n "$KEEP_MIN" <<< "$names")"
    cutoff="$(date -d "-$KEEP_DAYS days" '+%Y-%m-%d_%H%M%S')"
    while read -r n; do
        [ -n "$n" ] || continue
        grep -qxF "$n" <<< "$keep" && continue
        [[ "$n" < "$cutoff" ]] || continue
        if ! s3 delete "$(key_for "$n")" 2> "$ERR_FILE"; then
            log "    ВНИМАНИЕ: старые копии из хранилища не удаляются: $(s3_error)"
            log "    Если у ключа нет права удалять — задайте срок хранения правилом жизненного"
            log "    цикла бакета и BACKUP_OFFSITE_KEEP_DAYS=0 в .env (docs/UPDATE_GUIDE.md)."
            return 0
        fi
        s3 delete "$(key_for "$n").sha256" 2> /dev/null || true
        log "    удалена из хранилища копия старше $KEEP_DAYS дн.: $n"
    done <<< "$names"
}

# --- Список ------------------------------------------------------------------

do_list() {
    local rows n size modified when status ts rest
    require_config
    require_tools
    rows="$(remote_backups 2> "$ERR_FILE")" || die "хранилище недоступно: $(s3_error)"
    echo "Хранилище: $(where)"
    if [ -z "$rows" ]; then
        echo "Копий в хранилище нет. Выгрузить последнюю: bash scripts/offsite.sh"
    else
        # Ширину printf считает в байтах — заголовок выровнен вручную.
        echo "КОПИЯ                                  ВЫГРУЖЕНА         РАЗМЕР"
        while IFS=$'\t' read -r n size modified; do
            when="$(date -d "$modified" '+%d.%m.%Y %H:%M' 2> /dev/null || printf '%s' "$modified")"
            printf '%-38s %-17s %s\n' "$n" "$when" "$(human_size "$size")"
        done <<< "$rows"
        echo ""
        echo "Скачать на сервер: bash scripts/offsite.sh --get ИМЯ (или latest)"
    fi
    if [ -f "$BACKUP_DIR/offsite_status" ] && read -r status ts rest < "$BACKUP_DIR/offsite_status"; then
        [[ "$ts" =~ ^[0-9]+$ ]] || ts="$(date +%s)"
        if [ "$status" = "ok" ]; then
            echo "Последняя выгрузка: $rest, $(date -d "@$ts" '+%d.%m.%Y %H:%M')"
        else
            echo "Последняя выгрузка НЕ удалась ($(date -d "@$ts" '+%d.%m.%Y %H:%M')): $rest"
        fi
    fi
}

# --- Скачивание --------------------------------------------------------------

do_get() {
    local name rows size rc=0 tmp stage need free want got
    require_config
    require_passphrase
    require_tools
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    take_lock
    if [ "$TARGET" = "latest" ]; then
        rows="$(remote_backups 2> "$ERR_FILE")" || die "хранилище недоступно: $(s3_error)"
        name="$(tail -n 1 <<< "$rows" | cut -f1)"
        [ -n "$name" ] || die "в хранилище $(where) копий нет"
    else
        name="$(basename "$TARGET")"
        name="${name%.sha256}"
        name="${name%.tar.enc}"
        [[ "$name" =~ $NAME_RE ]] || die "это не имя копии: $TARGET (список: bash scripts/offsite.sh --list)"
    fi
    [ ! -e "$BACKUP_DIR/$name" ] || die "копия $name уже есть на сервере: $BACKUP_DIR/$name (восстановить: bash scripts/restore.sh $name)"

    size="$(s3 head "$(key_for "$name")" 2> "$ERR_FILE")" || rc=$?
    [ "$rc" -ne 3 ] || die "в хранилище нет копии $name (список: bash scripts/offsite.sh --list)"
    [ "$rc" -eq 0 ] || die "хранилище недоступно: $(s3_error)"
    need=$((size * 2 + 16 * 1024 * 1024))
    free="$(free_bytes "$BACKUP_DIR")"
    [ "${free:-0}" -ge "$need" ] || die "мало места: свободно $(human_size "${free:-0}"), нужно ~$(human_size "$need")"

    tmp="$BACKUP_DIR/.offsite-get-$name.tar.enc"
    stage="$BACKUP_DIR/.offsite-get-$name.partial"
    rm -rf -- "$tmp" "$tmp.sha256" "$stage"
    TMP_PATHS+=("$tmp" "$tmp.sha256" "$stage")
    log "Скачиваю $name ($(human_size "$size")) из $(where)"
    s3 get "$(key_for "$name")" "$tmp" 2> "$ERR_FILE" || die "не удалось скачать: $(s3_error)"

    rc=0
    s3 get "$(key_for "$name").sha256" "$tmp.sha256" 2> "$ERR_FILE" || rc=$?
    if [ "$rc" -eq 0 ]; then
        want="$(cut -d' ' -f1 < "$tmp.sha256")"
        got="$(sha256sum "$tmp" | cut -d' ' -f1)"
        [ "$want" = "$got" ] || die "контрольная сумма не сходится: файл повреждён в хранилище или при скачивании"
        log "    контрольная сумма: ок"
    elif [ "$rc" -eq 3 ]; then
        log "    контрольной суммы в хранилище нет — проверю файлы после расшифровки"
    else
        die "не удалось скачать контрольную сумму: $(s3_error)"
    fi

    # Сначала только расшифровка: неверную фразу openssl замечает в самом
    # конце, а tar на мусоре споткнулся бы раньше и с непонятной ошибкой.
    log "    расшифровываю"
    if ! DELO_OFFSITE_PASS="$PASSPHRASE" openssl enc -d "${CIPHER[@]}" -pass env:DELO_OFFSITE_PASS \
            -in "$tmp" -out /dev/null 2> "$ERR_FILE"; then
        grep -qi "bad decrypt" "$ERR_FILE" \
            && die "не расшифровывается: BACKUP_ENCRYPTION_PASSPHRASE не та фраза, которой копия зашифрована (при переезде нужна фраза со старого сервера)"
        die "не расшифровывается: $(s3_error)"
    fi
    mkdir -m 700 "$stage"
    if ! DELO_OFFSITE_PASS="$PASSPHRASE" openssl enc -d "${CIPHER[@]}" -pass env:DELO_OFFSITE_PASS -in "$tmp" 2> "$ERR_FILE" \
            | tar -C "$stage" -xf - 2>> "$ERR_FILE"; then
        die "архив не распаковывается (повреждён или фраза не та): $(s3_error)"
    fi
    [ -f "$stage/$name/OK" ] || die "в архиве нет готовой копии $name (нет файла OK)"
    (cd "$stage/$name" && sha256sum -c --quiet SHA256SUMS) > "$ERR_FILE" 2>&1 \
        || die "контрольные суммы файлов копии не сходятся: $(s3_error)"
    log "    файлы копии: контрольные суммы сходятся"
    mv -- "$stage/$name" "$BACKUP_DIR/$name"
    log "Готово: $BACKUP_DIR/$name"
    echo ""
    if [ -z "$(env_get SECRET_KEY)" ] && [ -f "$BACKUP_DIR/$name/env" ]; then
        adopt_env "$BACKUP_DIR/$name/env"
        echo "Сайт здесь ещё не установлен, поэтому .env взят из копии: прежние SECRET_KEY,"
        echo "пароль базы, токены. Настройки хранилища — те, что введены в --setup."
        echo "Дальше:"
        echo "  bash scripts/vps_deploy.sh          (на вопрос про демо-данные — «нет»)"
        echo "  bash scripts/restore.sh $name"
        return 0
    fi
    echo "Восстановить: bash scripts/restore.sh $name"
    if [ -f "$BACKUP_DIR/$name/env" ] \
        && [ "$(DELO_ENV_FILE="$BACKUP_DIR/$name/env" env_get SECRET_KEY)" != "$(env_get SECRET_KEY)" ]; then
        echo ""
        echo "ВНИМАНИЕ: SECRET_KEY в копии не тот, что в .env этого сервера. Им зашифрованы"
        echo "номера документов в базе: после восстановления с текущим ключом их не прочитать."
        echo "При переезде возьмите .env из копии ($BACKUP_DIR/$name/env) —"
        echo "docs/UPDATE_GUIDE.md, «Сервер пропал: восстановление из облака»."
    fi
}

# Сайт ещё не установлен (.env — заготовка из --setup): берём .env из копии
# с прежними секретами, а настройки хранилища — введённые сейчас (ключи в
# копии могли с тех пор отозвать).
adopt_env() {
    local src="$1" saved k v
    saved="$(mktemp)"
    TMP_PATHS+=("$saved")
    cp -- "$APP_DIR/.env" "$saved"
    install -m 600 -- "$src" "$APP_DIR/.env"
    for k in BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_PREFIX BACKUP_S3_ACCESS_KEY \
        BACKUP_S3_SECRET_KEY BACKUP_ENCRYPTION_PASSPHRASE BACKUP_OFFSITE_KEEP_DAYS; do
        v="$(DELO_ENV_FILE="$saved" env_get "$k")"
        [ -z "$v" ] || env_set "$k" "$v"
    done
}

# --- Проверка доступа --------------------------------------------------------

do_test() {
    local rc=0
    require_config
    require_tools
    echo "Хранилище: $(where)"
    probe || rc=$?
    [ "$rc" -ne 1 ] || die "доступа к хранилищу нет (подробности выше)"
    if [ "$rc" -eq 2 ]; then
        echo "Удалять ключ не может: старые копии убирайте правилом жизненного цикла бакета."
        [ "$KEEP_DAYS" = "0" ] || die "при этом в .env BACKUP_OFFSITE_KEEP_DAYS=$KEEP_DAYS — поставьте 0, иначе после каждой выгрузки будет ошибка удаления"
    fi
    if [ -z "$PASSPHRASE" ]; then
        die "доступ есть, но в .env нет BACKUP_ENCRYPTION_PASSPHRASE — копии не выгрузятся (bash scripts/offsite.sh --setup)"
    fi
    echo "Всё в порядке: копии выгружаются и скачиваются."
}

# --- Настройка ---------------------------------------------------------------

do_setup() {
    local new_server=0 answer="" choice="" default_choice=1 endpoint="" region="" bucket="" access="" secret=""
    local pass="" pass2="" rc=0 secret_hint=""
    if [ ! -f "$APP_DIR/.env" ]; then
        echo "Сайт на этом сервере ещё не установлен (нет $APP_DIR/.env)."
        ask answer "Это новый сервер, и вы восстанавливаете копию из хранилища? [y/N]" || true
        yes_answer "$answer" || die "сначала установите сайт: bash scripts/vps_deploy.sh — затем bash scripts/offsite.sh --setup"
        (umask 077 && : > "$APP_DIR/.env")
        CREATED_ENV=1
        new_server=1
    fi
    [ -w "$APP_DIR/.env" ] || die "нет прав на запись $APP_DIR/.env — запускайте от root"
    require_tools
    load_config

    echo "Копии будут выгружаться в облачное хранилище S3 другого провайдера — на случай,"
    echo "если этот сервер пропадёт. Как завести бакет и ключ — docs/UPDATE_GUIDE.md,"
    echo "раздел «Копии вне сервера»."
    echo ""
    echo "Хранилище:"
    echo "  1) Yandex Object Storage"
    echo "  2) Selectel"
    echo "  3) VK Cloud"
    echo "  4) другое (свой адрес S3)"
    case "$S3_ENDPOINT" in
        "" | https://storage.yandexcloud.net) default_choice=1 ;;
        https://s3.ru-1.storage.selcloud.ru) default_choice=2 ;;
        https://hb.ru-msk.vkcloud-s3.ru) default_choice=3 ;;
        *) default_choice=4 ;;
    esac
    ask choice "Номер" "$default_choice" || true
    case "$choice" in
        1) endpoint=https://storage.yandexcloud.net; region=ru-central1 ;;
        2) endpoint=https://s3.ru-1.storage.selcloud.ru; region=ru-1 ;;
        3) endpoint=https://hb.ru-msk.vkcloud-s3.ru; region=ru-msk ;;
        4)
            ask endpoint "Адрес хранилища (https://…)" "$S3_ENDPOINT" || true
            ask region "Регион" "$S3_REGION" || true
            ;;
        *) die "нет варианта «$choice»: введите номер от 1 до 4" ;;
    esac
    endpoint="${endpoint%/}"
    case "$endpoint" in
        https://?*) ;;
        http://?*) echo "ВНИМАНИЕ: адрес без https — ключи и копии пойдут по сети без защиты канала." ;;
        *) die "адрес хранилища должен начинаться с https://, получено: «$endpoint»" ;;
    esac
    [ -n "$region" ] || region=us-east-1

    ask bucket "Имя бакета" "$S3_BUCKET" || true
    [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] \
        || die "имя бакета — от 3 до 63 символов: строчные латинские буквы, цифры, точка и дефис (получено: «$bucket»)"
    ask access "Идентификатор ключа (Access key ID)" "$S3_ACCESS_KEY" || true
    access="$(printf '%s' "$access" | tr -d '[:space:]')"
    [ -n "$access" ] || die "идентификатор ключа не введён"
    [ -z "$S3_SECRET_KEY" ] || secret_hint="; Enter — оставить прежний"
    ask_secret secret "Секретный ключ (ввод скрыт$secret_hint)" || true
    secret="$(printf '%s' "$secret" | tr -d '[:space:]')"
    [ -n "$secret" ] || secret="$S3_SECRET_KEY"
    [ -n "$secret" ] || die "секретный ключ не введён"

    # Проверка — до записи в .env: с неверным ключом настройка не сохраняется
    # и не мешает ночным копиям.
    S3_ENDPOINT="$endpoint" S3_REGION="$region" S3_BUCKET="$bucket" S3_ACCESS_KEY="$access" S3_SECRET_KEY="$secret"
    echo ""
    echo "Проверяю доступ: $(where)"
    probe || rc=$?
    [ "$rc" -ne 1 ] || die "хранилище не приняло ключ или бакет (причина выше) — настройки не сохранены. Повторите: bash scripts/offsite.sh --setup"
    env_set BACKUP_S3_ENDPOINT "$endpoint"
    env_set BACKUP_S3_REGION "$region"
    env_set BACKUP_S3_BUCKET "$bucket"
    env_set BACKUP_S3_ACCESS_KEY "$access"
    env_set BACKUP_S3_SECRET_KEY "$secret"
    [ -n "$(env_get BACKUP_S3_PREFIX)" ] || env_set BACKUP_S3_PREFIX "$PREFIX"
    if [ "$rc" -eq 2 ]; then
        echo ""
        echo "Ключ не может удалять объекты — так даже надёжнее: взломав сервер, копии в"
        echo "хранилище не сотрёшь. Старые копии скрипт удалять не будет"
        echo "(BACKUP_OFFSITE_KEEP_DAYS=0) — задайте срок хранения правилом жизненного"
        echo "цикла бакета (docs/UPDATE_GUIDE.md, «Копии вне сервера»)."
        env_set BACKUP_OFFSITE_KEEP_DAYS 0
    elif [ -z "$(env_get BACKUP_OFFSITE_KEEP_DAYS)" ]; then
        env_set BACKUP_OFFSITE_KEEP_DAYS 30
    fi

    echo ""
    if [ -n "$PASSPHRASE" ]; then
        echo "Фраза шифрования уже задана — оставляю её: ею зашифрованы копии в хранилище."
    else
        echo "Копии шифруются фразой. Без неё их не расшифровать — ни хранилищу, ни вам."
        [ "$new_server" = 0 ] || echo "Вы восстанавливаете копию — введите фразу со старого сервера."
        ask_secret pass "Фраза шифрования (ввод скрыт; Enter — создать новую)" || true
        if [ -z "$pass" ]; then
            [ "$new_server" = 0 ] || die "без прежней фразы копии из хранилища не расшифровать — найдите её и повторите --setup"
            pass="$(openssl rand -hex 20)"
            echo ""
            echo "Фраза шифрования копий:"
            echo ""
            echo "    $pass"
            echo ""
            echo "Сохраните её СЕЙЧАС в менеджер паролей или запишите — НЕ на этом сервере."
            echo "Если сервер пропадёт, копию из хранилища расшифрует только она."
            while :; do
                ask answer "Сохранили? Напишите «да»" || die "ответа нет — фраза не записана, повторите: bash scripts/offsite.sh --setup"
                yes_answer "$answer" && break
            done
        else
            [[ "$pass" =~ $PASS_RE ]] \
                || die "фраза — от 12 символов: латинские буквы, цифры и знаки ._,:!?@%+=*~^/- (без пробелов, кавычек и «;»)"
            ask_secret pass2 "Повторите фразу" || true
            [ "$pass" = "$pass2" ] || die "фразы не совпали — шифрование не настроено, повторите --setup"
        fi
        env_set BACKUP_ENCRYPTION_PASSPHRASE "$pass"
    fi

    CREATED_ENV=0
    echo ""
    echo "Настройки записаны в .env."
    if [ "$new_server" = 1 ]; then
        echo "Дальше — скачать копию: bash scripts/offsite.sh --get latest"
        echo "(порядок целиком — docs/UPDATE_GUIDE.md, «Сервер пропал: восстановление из облака»)"
        return 0
    fi
    if [ -z "$(latest_full_backup)" ]; then
        echo "Готовых полных копий на сервере пока нет — первая выгрузится сама после"
        echo "ближайшей копии (сделать сейчас: bash scripts/backup.sh)."
    else
        echo "Выгружаю последнюю копию:"
        TARGET=latest
        do_push
    fi
    echo ""
    echo "Готово. Каждая полная копия теперь выгружается сама."
    echo "Что лежит в хранилище: bash scripts/offsite.sh --list"
    grep -qs 'backup.sh' "$CRON_FILE" || echo "Ночные копии ещё не включены: bash scripts/backup.sh --install"
}

case "$MODE" in
    setup) do_setup ;;
    push) do_push ;;
    list) do_list ;;
    get) do_get ;;
    test) do_test ;;
esac
