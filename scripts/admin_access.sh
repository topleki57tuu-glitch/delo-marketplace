#!/usr/bin/env bash
# ============================================================================
# Вход в админ-панель «ДЕЛО»: почта и пароль модератора.
#
#   bash scripts/admin_access.sh                # спросит почту и пароль
#   bash scripts/admin_access.sh you@mail.ru    # почта сразу, пароль спросит
#   bash scripts/admin_access.sh --check        # кто сейчас модератор
#
# Что делает:
#   1. заводит аккаунт с этой почтой или меняет пароль существующему. Пароль
#      вводится скрыто и не попадает ни в историю команд, ни в .env;
#   2. вписывает почту в ADMIN_EMAILS в .env — права модератора даёт только
#      этот список (backend/app/core/security.py, is_admin);
#   3. перезапускает backend, чтобы новый список применился.
#
# Аккаунт заводится раньше, чем выдаются права: адрес модератора не должен
# оставаться свободным. С сайта такие адреса не регистрируются — почта там не
# подтверждается, и права получил бы тот, кто первым займёт адрес.
#
# Запускать из каталога проекта на сервере (/opt/delo-marketplace) после
# scripts/vps_update.sh: работа с базой идёт внутри контейнера backend.
# ============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"
cd "$APP_DIR"

[ -f .env ] || { echo "Нет .env в $APP_DIR — сначала запустите scripts/vps_deploy.sh"; exit 1; }

# stdin закрываем: иначе docker compose exec читает терминал и может
# «съесть» ввод, предназначенный следующему вопросу скрипта.
run_py() {
    $COMPOSE exec -T backend python create_admin.py "$@" </dev/null
}

# Пароль подаётся на stdin — не аргументом, который виден в списке процессов.
run_py_stdin() {
    $COMPOSE exec -T backend python create_admin.py "$@"
}

# ADMIN_EMAILS из .env: без кавычек, пробелов и \r (файл могли править в
# Windows), в нижнем регистре — так же его читает backend.
current_admins() {
    { grep -m1 -E '^[[:space:]]*ADMIN_EMAILS=' .env || true; } \
        | cut -d= -f2- | tr -d "\"' \r" | tr '[:upper:]' '[:lower:]'
}

if ! $COMPOSE exec -T backend test -f create_admin.py </dev/null >/dev/null 2>&1; then
    echo "backend не запущен или собран из старой версии кода."
    echo "Сначала обновите сервер: bash scripts/vps_update.sh"
    exit 1
fi

ADMINS="$(current_admins)"

if [ "${1:-}" = "--check" ]; then
    run_py --check --emails "$ADMINS"
    exit 0
fi

EMAIL_RAW="${1:-}"
if [ -z "$EMAIL_RAW" ]; then
    echo "Сейчас права модератора у: ${ADMINS:-никого}"
    read -r -p "Почта администратора: " EMAIL_RAW || EMAIL_RAW=""
fi
[ -n "$EMAIL_RAW" ] || { echo "Почта не указана — ничего не изменено."; exit 1; }
EMAIL="$(run_py "$EMAIL_RAW" --normalize)" || exit 1

echo ""
echo "Пароль для $EMAIL: не меньше 8 символов и хотя бы одна цифра."
echo "Ввод не отображается. Оставьте пустым — пароль сгенерируется."
IFS= read -r -s -p "Новый пароль: " PASS1 || PASS1=""; echo
if [ -z "$PASS1" ]; then
    run_py "$EMAIL" --generate --no-rights-note
else
    IFS= read -r -s -p "Повторите пароль: " PASS2 || PASS2=""; echo
    if [ "$PASS1" != "$PASS2" ]; then
        unset PASS1 PASS2
        echo "Пароли не совпадают — ничего не изменено."
        exit 1
    fi
    # printf — встроенная команда bash: пароль не появляется в списке процессов.
    printf '%s\n' "$PASS1" | run_py_stdin "$EMAIL" --password-stdin --no-rights-note
    unset PASS1 PASS2
fi

# Новый список модераторов: эта почта и, если владелец согласен, остальные.
OTHERS="$(printf '%s' "$ADMINS" | tr ',' '\n' | grep -vxF -- "$EMAIL" | grep -v '^$' | paste -sd, - || true)"
NEW_LIST="$EMAIL"
if [ -n "$OTHERS" ]; then
    echo ""
    echo "Права модератора сейчас есть ещё у: $OTHERS"
    read -r -p "Оставить им права? [y/N] " KEEP || KEEP=""
    case "$KEEP" in
        [yYдД]*) NEW_LIST="$EMAIL,$OTHERS" ;;
        *) echo "    права останутся только у $EMAIL" ;;
    esac
fi

if [ "$NEW_LIST" = "$ADMINS" ]; then
    echo "==> ADMIN_EMAILS не изменился: $NEW_LIST"
else
    echo "==> ADMIN_EMAILS=$NEW_LIST"
    if grep -qE '^[[:space:]]*ADMIN_EMAILS=' .env; then
        TMP="$(mktemp "$APP_DIR/.env.XXXXXX")"
        trap 'rm -f "$TMP"' EXIT
        awk -v line="ADMIN_EMAILS=$NEW_LIST" '
            /^[[:space:]]*ADMIN_EMAILS=/ { if (!done) { print line; done = 1 }; next }
            { print }
        ' .env > "$TMP"
        # cat >, а не mv: у .env остаются права 600 и владелец.
        cat "$TMP" > .env
    else
        if [ -s .env ] && [ -n "$(tail -c 1 .env)" ]; then echo "" >> .env; fi
        echo "ADMIN_EMAILS=$NEW_LIST" >> .env
    fi

    echo "==> Перезапуск backend с новым списком"
    # up -d пересоздаёт только контейнеры, чьё окружение изменилось.
    $COMPOSE up -d
    for i in $(seq 1 60); do
        if $COMPOSE exec -T backend python -c \
            "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')" </dev/null >/dev/null 2>&1; then
            break
        fi
        [ "$i" = 60 ] && { echo "backend не поднялся, логи:"; $COMPOSE logs --tail 50 backend; exit 1; }
        sleep 2
    done
    echo "    backend отвечает"
fi

SITE_URL="$(grep -m1 '^FRONTEND_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$SITE_URL" ] || SITE_URL="сайт"

echo ""
echo "=========================================="
echo " Готово. Вход: $SITE_URL"
echo " Почта:  $EMAIL"
echo " Пароль: тот, что вы ввели (или напечатан выше)"
echo " В меню профиля появится «Админ-панель»."
echo "=========================================="
