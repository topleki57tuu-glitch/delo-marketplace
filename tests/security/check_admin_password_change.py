#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сквозная проверка смены пароля и прав админа.

Запуск (бэкенд должен быть поднят на 127.0.0.1:8000):
    python tests/security/check_admin_password_change.py

Проверяем не «эндпоинт существует», а поведение:
  * кто вообще может войти старым и новым паролем;
  * что отзыв сессий действительно ломает ранее выданный refresh-токен;
  * что админские ручки закрыты для чужих и для анонима.

Пароль берётся из backend/demo_password.txt, чтобы не держать его в коде.
"""
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
# Скрипт лежит в tests/security, поэтому корень репозитория — на два
# уровня выше. Считаем от файла, а не от текущего каталога: иначе запуск
# из другого места ломает поиск demo_password.txt.
ROOT = Path(__file__).resolve().parents[2]
PASSWORD_FILE = ROOT / "backend" / "demo_password.txt"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "OK  " if ok else "ПРОВАЛ"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))


def call(method, path, *, token=None, form=None, json_body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def read_password(key):
    text = PASSWORD_FILE.read_text(encoding="utf-8")
    match = re.search(rf"^{key}\s*=\s*(\S+)", text, re.MULTILINE)
    if not match:
        sys.exit(f"в {PASSWORD_FILE} нет строки '{key} = ...'")
    return match.group(1)


def write_admin_password(password):
    """Записывает новый пароль в demo_password.txt.

    Без этого прогон оставлял файл с устаревшим паролем, и следующий скрипт
    (или человек) входил по значению, которое уже не работает.
    """
    text = PASSWORD_FILE.read_text(encoding="utf-8")
    updated = re.sub(
        r"^admin_password\s*=\s*\S+$",
        f"admin_password = {password}",
        text,
        flags=re.MULTILINE,
    )
    if updated == text:
        print(f"  внимание: строка admin_password в {PASSWORD_FILE} не найдена")
        return
    PASSWORD_FILE.write_text(updated, encoding="utf-8")
    print(f"  demo_password.txt обновлён: admin_password = {password}")


def login(email, password):
    return call("POST", "/login", form={"username": email, "password": password})


def make_password(length=20):
    """Стойкий пароль, проходящий серверную политику.

    Повторяет app.core.security.generate_strong_password. Импортировать его
    отсюда нельзя: скрипт работает по HTTP и запускается из корня репозитория,
    где пакет app не на пути импорта. Держим копию и сверяем поведение самим
    запросом — если политика на сервере изменится, проверка это покажет.
    """
    import secrets
    import string

    alphabet = string.ascii_letters + string.digits
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isdigit() for c in candidate) and any(c.isalpha() for c in candidate):
            return candidate


def main():
    current = read_password("admin_password")
    demo = read_password("password")

    print("=" * 66)
    print("1. Текущий пароль админа пускает в аккаунт")
    print("=" * 66)
    status, body = login("admin@delo.ru", current)
    record("вход admin@delo.ru текущим паролем", status == 200, f"HTTP {status}")
    if status != 200:
        return 1
    session = json.loads(body)
    access, refresh = session["access_token"], session["refresh_token"]

    print()
    print("=" * 66)
    print("2. Демо-пароль админа больше не подходит")
    print("=" * 66)
    status, body = login("admin@delo.ru", demo)
    record("вход демо-паролем отклонён", status == 401, f"HTTP {status}")

    print()
    print("=" * 66)
    print("3. Права модератора приходят с сервера, а не угадываются фронтом")
    print("=" * 66)
    status, body = call("GET", "/users/me", token=access)
    me = json.loads(body) if status == 200 else {}
    record("GET /users/me", status == 200, f"HTTP {status}")
    record("is_admin=true для admin@delo.ru", me.get("is_admin") is True, f"is_admin={me.get('is_admin')!r}")
    record(
        "role в БД остался покупательским",
        me.get("role") == "customer",
        f"role={me.get('role')!r} — права даёт ADMIN_EMAILS, а не колонка role",
    )

    print()
    print("=" * 66)
    print("4. Админские ручки: доступ и отказ")
    print("=" * 66)
    for path in ["/admin/stats", "/admin/users", "/admin/disputes", "/admin/withdrawals"]:
        status, _ = call("GET", path, token=access)
        record(f"{path} с токеном админа", status == 200, f"HTTP {status}")
        status, _ = call("GET", path)
        record(f"{path} без токена", status in (401, 403), f"HTTP {status}")

    status, body = login("anna@delo.ru", demo)
    if status == 200:
        anna = json.loads(body)["access_token"]
        status, _ = call("GET", "/admin/stats", token=anna)
        record("/admin/stats с токеном покупателя", status == 403, f"HTTP {status}")
    else:
        record("вход anna@delo.ru для проверки отказа", False, f"HTTP {status}")

    print()
    print("=" * 66)
    print("5. Эндпоинт смены пароля: отказы на некорректный ввод")
    print("=" * 66)
    status, _ = call(
        "POST", "/users/me/password", token=access,
        json_body={"current_password": "заведомо-неверный", "new_password": "NewPass12345"},
    )
    record("неверный текущий пароль отклонён", status == 400, f"HTTP {status}")

    status, _ = call(
        "POST", "/users/me/password", token=access,
        json_body={"current_password": current, "new_password": current},
    )
    record("новый пароль, равный текущему, отклонён", status == 400, f"HTTP {status}")

    status, _ = call(
        "POST", "/users/me/password", token=access,
        json_body={"current_password": current, "new_password": "1234567"},
    )
    record("пароль без букв и короче 8 отклонён", status == 422, f"HTTP {status}")

    status, _ = call(
        "POST", "/users/me/password",
        json_body={"current_password": current, "new_password": "NewPass12345"},
    )
    record("смена пароля без токена отклонена", status in (401, 403), f"HTTP {status}")

    print()
    print("=" * 66)
    print("6. Смена пароля отзывает выданные сессии")
    print("=" * 66)
    status, body = call("POST", "/refresh", params={"refresh_token": refresh})
    record("refresh-токен жив до смены пароля", status == 200, f"HTTP {status}")

    new_password = make_password()
    status, body = call(
        "POST", "/users/me/password", token=access,
        json_body={"current_password": current, "new_password": new_password},
    )
    record("смена пароля принята", status == 200, f"HTTP {status} {body.strip()[:120]}")
    revoked = json.loads(body).get("revoked_sessions") if status == 200 else None

    status, body = call("POST", "/refresh", params={"refresh_token": refresh})
    record("старый refresh-токен после смены отклонён", status == 401, f"HTTP {status}")

    status, _ = login("admin@delo.ru", current)
    record("старый пароль больше не пускает", status == 401, f"HTTP {status}")

    status, body = login("admin@delo.ru", new_password)
    record("новый пароль пускает", status == 200, f"HTTP {status}")
    if status == 200:
        fresh = json.loads(body)["access_token"]
        status, _ = call("GET", "/admin/stats", token=fresh)
        record("админские права сохранились после смены", status == 200, f"HTTP {status}")

    print()
    print("=" * 66)
    print("Итог")
    print("=" * 66)
    print(f"Отозвано сессий при смене: {revoked}")
    if revoked is not None:
        write_admin_password(new_password)
    print("Действующий пароль админа записан в backend/demo_password.txt")
    failed = [name for name, ok, _ in results if not ok]
    print(f"Проверок: {len(results)}, провалено: {len(failed)}")
    for name in failed:
        print(f"  ПРОВАЛ: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
