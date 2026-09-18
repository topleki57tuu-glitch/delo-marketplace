#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Регресс-тест защиты CSRF на state-changing эндпоинтах.

Проверяет, что эндпоинты, которые раньше не были защищены (споры,
выводы средств, уведомления, чат, отзывы, отклики, профиль, верификация),
теперь отклоняют запрос **без** заголовка X-CSRF-Token, когда
CSRF_ENABLED включён.

Запуск (backend с CSRF_ENABLED=1):
    CSRF_ENABLED=1 uvicorn main:app --port 8000      # в каталоге backend
    python tests/test_csrf_coverage.py

Если CSRF_ENABLED выключен, тест переключается в режим "informational":
он всё равно вызовет эндпоинты и покажет, что защита неактивна, но
не будет падать — так файл безопасно держать в общем прогоне.
"""
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import Session  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://localhost:8000")
TS = int(time.time())

PASSED = 0
FAILED = 0


def check(name, ok, extra=""):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  OK  {name}" + (f" | {extra}" if extra else ""))
    else:
        FAILED += 1
        print(f"  FAIL {name}" + (f" | {extra}" if extra else ""))
    return ok


def main():
    global PASSED, FAILED
    print("=== CSRF: покрытие state-changing эндпоинтов ===")
    print(f"BASE = {BASE}\n")

    s = Session(BASE)

    # Узнаём, включён ли CSRF на бэкенде. Пробуем state-changing запрос
    # без токена: 403 => защита активна.
    probe = requests.post(
        f"{BASE}/auth/forgot-password",
        json={"email": "csrf.probe@test.ru"},
        timeout=15,
    )
    csrf_on = probe.status_code == 403
    print(f"CSRF_ENABLED на бэкенде: {'ДА' if csrf_on else 'НЕТ'}")
    if not csrf_on:
        print("  (тест выполнится в режиме informational — защита выключена)")

    # Готовим двух пользователей и задание в работе — чтобы было что ломать.
    c_email = f"csrf.cust.{TS}@test.ru"
    s_email = f"csrf.spec.{TS}@test.ru"
    pwd = "Password123"

    s.register(c_email, pwd, "customer", "CSRF Заказчик")
    s.register(s_email, pwd, "specialist", "CSRF Исполнитель")
    c_tok = s.login(c_email, pwd)
    s_tok = s.make_specialist(s_email, pwd)

    # Пополняем баланс заказчика (с CSRF-заголовком — это легитимный запрос)
    s.post("/wallet/deposit", json={"amount": 5000}, headers=s.auth(c_tok))
    t_res = s.post(
        "/tasks/",
        json={
            "title": "CSRF проверка",
            "description": "Задача для проверки CSRF-покрытия эндпоинтов",
            "budget": 2000,
            "category": "design",
        },
        headers=s.auth(c_tok),
    )
    if t_res.status_code != 200:
        print(f"  !! не удалось создать задание: {t_res.status_code} {t_res.text[:200]}")
        return 1
    task_id = t_res.json()["task_id"]

    # Отклик исполнителя — нужен для последующих проверок
    s.post(
        f"/tasks/{task_id}/responses",
        json={"text": "Беру задачу", "proposed_price": 2000, "estimated_days": 2},
        headers=s.auth(s_tok),
    )
    spec_id = s.get("/users/me", headers=s.auth(s_tok)).json()["id"]
    s.put(
        f"/tasks/{task_id}/assign?specialist_id={spec_id}",
        headers=s.auth(c_tok),
    )

    # --- Кейсы: каждый эндпоинт БЕЗ CSRF-заголовка -------------------------
    # (метод, путь, тело, токен, человекочитаемое имя)
    cases = [
        ("PUT", "/users/me", {"name": "Взломанное имя"}, c_tok, "PUT /users/me (профиль)"),
        ("POST", "/users/me/switch-role", None, c_tok, "POST /users/me/switch-role"),
        ("POST", "/wallet/withdraw", {"amount": 100, "requisites": "test"}, c_tok, "POST /wallet/withdraw"),
        ("POST", f"/tasks/{task_id}/messages", {"text": "spam"}, c_tok, "POST /tasks/{id}/messages (чат)"),
        ("POST", f"/tasks/{task_id}/responses", {"text": "x", "proposed_price": 1, "estimated_days": 1}, s_tok, "POST /tasks/{id}/responses"),
        ("POST", f"/tasks/{task_id}/review", {"rating": 5, "text": "ok"}, c_tok, "POST /tasks/{id}/review"),
        ("POST", "/notifications/read-all", None, c_tok, "POST /notifications/read-all"),
        ("POST", "/verification/submit", {"full_name": "X", "passport": "1234 567890"}, c_tok, "POST /verification/submit"),
        ("POST", "/ai/task-helper", {"prompt": "привет"}, c_tok, "POST /ai/task-helper"),
    ]

    print("\n--- Запросы без заголовка X-CSRF-Token ---")
    for method, path, body, token, label in cases:
        # Явно чистим CSRF-заголовок, чтобы имитировать атакующий сайт,
        # который не может прочитать cookie и подставить токен.
        s.clear_csrf()
        kw = {"headers": s.auth(token), "timeout": 15}
        if body is not None:
            kw["json"] = body
        r = requests.request(method, f"{BASE}{path}", **kw)

        if csrf_on:
            check(f"{label} -> 403", r.status_code == 403, f"получен {r.status_code}")
        else:
            # Защита выключена: фиксируем фактический код, но не падаем.
            print(f"  INFO {label} -> {r.status_code} (CSRF off)")

    print(f"\n=== ИТОГ: passed={PASSED} failed={FAILED} ===")
    if csrf_on and FAILED:
        print("!!! Есть незащищённые эндпоинты — проверь Depends(verify_csrf)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
