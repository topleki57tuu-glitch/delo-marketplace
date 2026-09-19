#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка ограничения перебора пароля по аккаунту.

Запуск (бэкенд поднят с RATE_LIMIT_ENABLED=1):
    RATE_LIMIT_ENABLED=1 python -m uvicorn main:app --port 8000
    python tests/security/check_login_throttle.py

Что именно доказываем. Лимит по IP уже был — 10 попыток на адрес за 5 минут.
Он не мешает подбирать пароль к ОДНОЙ учётной записи, если адрес меняется:
каждый новый IP приносит свои 10 попыток. Поэтому каждый запрос здесь идёт
с собственного X-Forwarded-For — с точки зрения лимита по IP все они разные
клиенты. Если после восьми неудач девятая попытка получает 429, значит порог
считается по аккаунту, а не по адресу.

Заголовок X-Forwarded-For принимается только от приватного адреса клиента
(см. _client_ip), а мы ходим с 127.0.0.1 — то есть подделка здесь разрешена
намеренно, чтобы развести адреса.
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

ACCOUNT_LIMIT = 8  # ACCOUNT_LOGIN_LIMIT из app/core/security.py

results = []
ip_counter = [0]


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'OK  ' if ok else 'ПРОВАЛ'}] {name}" + (f" — {detail}" if detail else ""))


def fresh_ip():
    """Каждый вызов — новый «адрес», чтобы лимит по IP не вмешивался."""
    ip_counter[0] += 1
    return f"203.0.113.{ip_counter[0]}"


def login(email, password, ip=None):
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if ip:
        headers["X-Forwarded-For"] = ip
    data = urllib.parse.urlencode({"username": email, "password": password}).encode()
    req = urllib.request.Request(BASE + "/login", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def read_password(key):
    text = PASSWORD_FILE.read_text(encoding="utf-8")
    match = re.search(rf"^{key}\s*=\s*(\S+)", text, re.MULTILINE)
    if not match:
        sys.exit(f"в {PASSWORD_FILE} нет строки '{key} = ...'")
    return match.group(1)


def main():
    admin = "admin@delo.ru"
    demo = read_password("password")

    # Разогревающий запрос идёт по НЕСУЩЕСТВУЮЩЕМУ аккаунту: он проверяет,
    # что лимиты вообще включены, и при этом не тратит попытки admin@delo.ru.
    # (Первый прогон этого скрипта так и ошибся: разогрев по админу съел одну
    # попытку, и 429 пришёл на восьмой итерации вместо девятой.)
    status, _ = login("probe-nonexistent@delo.ru", "мусор", ip=fresh_ip())
    if status == 200:
        sys.exit("вход с заведомо неверным паролем прошёл — проверяем не тот стенд")
    if status == 429:
        sys.exit("429 на разогреве — бэкенд запущен не с RATE_LIMIT_ENABLED=1")

    print("=" * 68)
    print("1. Перебор одного аккаунта с разных адресов")
    print("=" * 68)
    print(f"Порог по аккаунту: {ACCOUNT_LIMIT} неудачи за окно")
    codes = []
    for i in range(1, ACCOUNT_LIMIT + 2):
        ip = fresh_ip()
        status, body = login(admin, f"мусор-{i}", ip=ip)
        codes.append(status)
        print(f"  попытка {i} с адреса {ip} -> HTTP {status}")

    # Лимит по IP здесь не мог сработать: каждый запрос шёл с нового адреса,
    # и ни один адрес не сделал больше одной попытки.
    record(
        f"первые {ACCOUNT_LIMIT} попыток отбиты проверкой пароля",
        codes[:ACCOUNT_LIMIT] == [401] * ACCOUNT_LIMIT,
        f"коды: {codes[:ACCOUNT_LIMIT]}",
    )
    record(
        f"попытка {ACCOUNT_LIMIT + 1} отбита лимитом",
        codes[ACCOUNT_LIMIT] == 429,
        f"HTTP {codes[ACCOUNT_LIMIT]}",
    )

    print()
    print("=" * 68)
    print("2. Отбита именно учётная запись, а не адрес")
    print("=" * 68)
    status, body = login(admin, "мусор-ещё", ip=fresh_ip())
    try:
        detail = json.loads(body).get("detail", "")
    except Exception:
        detail = body.strip()[:160]
    print(f"  ответ: {detail}")
    # У лимита по IP своя формулировка («Слишком много запросов, пожалуйста,
    # повторите попытку через минуту»). Раз пришла формулировка про аккаунт —
    # сработал счётчик по аккаунту, а не общий лимит по адресу.
    record(
        "в ответе — предупреждение про аккаунт, а не про частоту запросов",
        status == 429 and "аккаунт" in detail,
        f"HTTP {status}",
    )

    print()
    print("=" * 68)
    print("3. Блокировка привязана к аккаунту, а не ко всем входящим")
    print("=" * 68)
    ip = fresh_ip()
    status, body = login("anna@delo.ru", demo, ip=ip)
    record(
        "другой аккаунт с нового адреса входит нормально",
        status == 200,
        f"HTTP {status} — значит 429 выше был про admin@delo.ru, а не про клиента",
    )
    if status != 200:
        print(f"  ответ: {body.strip()[:200]}")

    print()
    print("=" * 68)
    print("4. Успешный вход обнуляет счётчик неудач")
    print("=" * 68)
    for i in range(1, 6):
        login("anna@delo.ru", f"мусор-{i}", ip=fresh_ip())
    status, _ = login("anna@delo.ru", demo, ip=fresh_ip())
    record("вход после 5 неудач прошёл", status == 200, f"HTTP {status}")

    codes = []
    for i in range(1, ACCOUNT_LIMIT + 2):
        status, _ = login("anna@delo.ru", f"мусор-после-{i}", ip=fresh_ip())
        codes.append(status)
    print(f"  коды следующих {len(codes)} попыток: {codes}")
    record(
        "после успешного входа счётчик начал отсчёт заново",
        codes[:ACCOUNT_LIMIT] == [401] * ACCOUNT_LIMIT and codes[ACCOUNT_LIMIT] == 429,
        "если бы счётчик не обнулился, 429 пришёл бы уже на 4-й попытке",
    )

    print()
    print("=" * 68)
    print("Итог")
    print("=" * 68)
    failed = [name for name, ok, _ in results if not ok]
    print(f"Проверок: {len(results)}, провалено: {len(failed)}")
    for name in failed:
        print(f"  ПРОВАЛ: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
