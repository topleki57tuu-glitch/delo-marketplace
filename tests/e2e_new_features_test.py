#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
E2E-тест новых фич маркетплейса «ДЕЛО»:
  * каталог специалистов (поиск, сортировка, пагинация)
  * история транзакций + CSV-экспорт
  * споры/арбитраж: открытие спора, блокировка завершения, решения арбитра
  * отмена назначения с возвратом эскроу
  * сброс пароля (dev-фолбэк ссылки без SMTP)

Запускать при работающем backend (uvicorn на :8000) после seed_demo.py:
    python3 tests/e2e_new_features_test.py

Примечание: для проверок арбитража нужен аккаунт администратора из seed_demo.py.
Пароль задаётся переменной окружения DEMO_PASSWORD (раньше был захардкожен
как insecure-дефолт), а email — через ADMIN_EMAILS. При запуске seed в том же
окружении тест подхватит их сам; без DEMO_PASSWORD проверки арбитража
пропускаются (SKIP), а не падают.
"""
import os
import json
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import Session  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://localhost:8000")
TS = int(time.time())
S = Session(BASE)  # CSRF-aware HTTP-сессия

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


def register(email, password, role, name):
    return S.register(email, password, role, name)


def login(email, password):
    return S.login(email, password)


def auth(token):
    return S.auth(token)


def balance(token):
    return S.get("/users/me", headers=S.auth(token)).json()["balance"]


def main():
    print("=== E2E: новые фичи ДЕЛО (споры, каталог, CSV, сброс пароля) ===")
    print(f"BASE = {BASE}\n")

    # ---------- Подготовка: свежие заказчик и специалист ----------
    cust_email = f"e2e2.customer.{TS}@test.ru"
    spec_email = f"e2e2.specialist.{TS}@test.ru"
    register(cust_email, "Password1", "customer", "Тест Заказчик")
    register(spec_email, "Password1", "specialist", "Тест Специалист")
    cust_tok = login(cust_email, "Password1")
    spec_tok = login(spec_email, "Password1")

    # ---------- 1. Каталог специалистов ----------
    print("\n--- Каталог специалистов ---")
    S.put(f"/users/me", headers=auth(spec_tok),
        json={"bio": "Тестовый специалист по дизайну", "city": "Тестбург",
              "skills": json.dumps(["Figma", "UI/UX"])},
        timeout=15,
    )

    r = S.get(f"/specialists/", timeout=15)
    data = r.json()
    check("GET /specialists/ (200, структура)",
          r.status_code == 200 and "items" in data and "total" in data and "pages" in data,
          f"total={data.get('total')}")

    r = S.get(f"/specialists/", params={"search": "Тест Специалист"}, timeout=15)
    data = r.json()
    check("GET /specialists/?search= (по имени)",
          r.status_code == 200 and any(s["name"] == "Тест Специалист" for s in data["items"]),
          f"total={data.get('total')}")

    r = S.get(f"/specialists/", params={"city": "Тестбург"}, timeout=15)
    data = r.json()
    check("GET /specialists/?city= (фильтр по городу)",
          r.status_code == 200 and data["total"] >= 1
          and all("Тестбург" in (s.get("city") or "") for s in data["items"]))

    r = S.get(f"/specialists/", params={"per_page": 2, "page": 1}, timeout=15)
    d1 = r.json()
    r2 = S.get(f"/specialists/", params={"per_page": 2, "page": 2}, timeout=15)
    d2 = r2.json()
    check("GET /specialists/ (пагинация)",
          len(d1["items"]) <= 2 and d1["pages"] >= 1
          and (d1["pages"] == 1 or d1["items"][0]["id"] != d2["items"][0]["id"]),
          f"pages={d1['pages']}")

    for sort in ("rating", "completed", "reviews", "newest"):
        r = S.get(f"/specialists/", params={"sort": sort}, timeout=15)
        check(f"GET /specialists/?sort={sort}", r.status_code == 200)

    r = S.get(f"/specialists/", params={"sort": "wrong"}, timeout=15)
    check("GET /specialists/?sort=wrong -> 422", r.status_code == 422)

    # ---------- 2. История транзакций + CSV ----------
    print("\n--- История транзакций и CSV ---")
    r = S.post(f"/wallet/deposit", headers=auth(cust_tok),
                      json={"amount": 20000}, timeout=15)
    check("POST /wallet/deposit (+20000)", r.status_code == 200)

    r = S.get(f"/wallet/transactions", headers=auth(cust_tok), timeout=15)
    txs = r.json()
    check("GET /wallet/transactions", r.status_code == 200 and len(txs) >= 1
          and txs[0]["type"] == "deposit" and txs[0]["amount"] == 20000,
          f"txs={len(txs)}")

    r = S.get(f"/wallet/transactions.csv", headers=auth(cust_tok), timeout=15)
    body = r.content.decode("utf-8")
    # CSV-экспорт добавляет BOM (utf-8-sig) — срезаем его перед проверкой.
    body_clean = body.lstrip("\ufeff").strip()
    lines = body_clean.splitlines()
    check("GET /wallet/transactions.csv",
          r.status_code == 200 and "text/csv" in r.headers.get("Content-Type", "")
          and "Пополнение" in body_clean and "20000" in body_clean
          and len(lines) >= 2,  # заголовок + хотя бы одна операция
          f"строк: {len(lines)}, content-type={r.headers.get('Content-Type')=!r}")

    r = S.get(f"/wallet/transactions.csv", timeout=15)
    check("CSV без токена -> 401/403", r.status_code in (401, 403))

    # ---------- 3. Спор и арбитраж ----------
    print("\n--- Споры и арбитраж ---")
    # Заказ №1: назначение -> спор -> арбитраж (возврат заказчику)
    r = S.post(f"/tasks/", headers=auth(cust_tok), json={
        "title": f"DISPUTE-{TS} Дизайн логотипа", "description": "Нужен логотип.",
        "budget": 7000, "category": "design", "is_remote": True,
    }, timeout=15)
    task1 = r.json()["task_id"]

    cust_id = S.get(f"/users/me", headers=auth(cust_tok), timeout=15).json()["id"]
    spec_id = S.get(f"/users/me", headers=auth(spec_tok), timeout=15).json()["id"]

    S.post(f"/tasks/{task1}/responses", headers=auth(spec_tok),
                  json={"text": "Сделаю!"}, timeout=15)
    r = S.put(f"/tasks/{task1}/assign",
                     params={"specialist_id": spec_id}, headers=auth(cust_tok), timeout=15)
    check("PUT /tasks/{id}/assign (эскроу-холд)", r.status_code == 200)
    check("Баланс заказчика после холда", balance(cust_tok) == 20000 - 7000,
          f"balance={balance(cust_tok)}")

    r = S.post(f"/tasks/{task1}/dispute", headers=auth(spec_tok),
                      json={"reason": "Заказчик не предоставляет исходные материалы неделю."},
                      timeout=15)
    check("POST /tasks/{id}/dispute (спор открыт)", r.status_code == 200, r.text[:60])

    r = S.post(f"/tasks/{task1}/dispute", headers=auth(cust_tok),
                      json={"reason": "Повторный спор"}, timeout=15)
    check("Повторный спор -> 400", r.status_code == 400)

    r = S.get(f"/tasks/{task1}", timeout=15)
    check("Заказ в статусе disputed", r.json()["status"] == "disputed")

    r = S.put(f"/tasks/{task1}/complete", headers=auth(cust_tok), timeout=15)
    check("Завершение при споре -> 400", r.status_code == 400)

    r = S.get(f"/tasks/{task1}/dispute", headers=auth(cust_tok), timeout=15)
    d = r.json().get("dispute")
    check("GET /tasks/{id}/dispute (участник видит спор)",
          r.status_code == 200 and d and d["status"] == "open" and d["opened_by"] == spec_id)
    dispute1 = d["id"]

    # Отмена не инициатором спора запрещена
    r = S.post(f"/tasks/{task1}/cancel", headers=auth(cust_tok), timeout=15)
    check("Отмена заказчиком при чужом споре -> 403", r.status_code == 403)

    # Арбитраж.
    # Учётка админа создаётся seed_demo.py. Пароль больше не хардкодится в
    # seed (был demo123), а берётся из DEMO_PASSWORD или генерируется —
    # поэтому здесь читаем те же переменные окружения.
    admin_email = os.environ.get("ADMIN_EMAILS", "admin@delo.ru").split(",")[0].strip()
    admin_pwd = os.environ.get("DEMO_PASSWORD", "")
    admin_tok = None
    if admin_pwd:
        try:
            admin_tok = login(admin_email, admin_pwd)
        except RuntimeError:
            admin_tok = None
    else:
        print("  SKIP Арбитр: DEMO_PASSWORD не задан (seed не запускался)")

    if admin_pwd:
        check(f"Арбитр {admin_email} доступен (seed)", bool(admin_tok))

    if admin_tok:
        r = S.get(f"/admin/disputes", headers=auth(cust_tok), timeout=15)
        check("GET /admin/disputes не-админом -> 403", r.status_code == 403)

        r = S.get(f"/admin/disputes", headers=auth(admin_tok), timeout=15)
        lst = r.json()
        check("GET /admin/disputes (арбитр)",
              r.status_code == 200 and any(x["id"] == dispute1 for x in lst["disputes"]),
              f"open={lst.get('count')}")

        r = S.post(f"/admin/disputes/{dispute1}/resolve",
                          headers=auth(admin_tok),
                          json={"decision": "refund_customer", "comment": "Работа не начата, возврат."},
                          timeout=15)
        check("POST /admin/disputes/{id}/resolve (refund)", r.status_code == 200, r.text[:70])
        check("Баланс заказчика после возврата", balance(cust_tok) == 20000,
              f"balance={balance(cust_tok)}")

        r = S.get(f"/tasks/{task1}", timeout=15)
        check("Заказ отменён после refund", r.json()["status"] == "cancelled")

        r = S.post(f"/admin/disputes/{dispute1}/resolve",
                          headers=auth(admin_tok),
                          json={"decision": "pay_specialist"}, timeout=15)
        check("Повторное решение спора -> 400", r.status_code == 400)

    # ---------- 4. Отмена назначения с возвратом эскроу ----------
    print("\n--- Отмена назначения (возврат эскроу) ---")
    r = S.post(f"/tasks/", headers=auth(cust_tok), json={
        "title": f"CANCEL-{TS} Монтаж видео", "description": "Смонтировать ролик.",
        "budget": 4000, "category": "photo_video", "is_remote": True,
    }, timeout=15)
    task2 = r.json()["task_id"]
    S.post(f"/tasks/{task2}/responses", headers=auth(spec_tok),
                  json={"text": "Возьмусь."}, timeout=15)
    S.put(f"/tasks/{task2}/assign",
                 params={"specialist_id": spec_id}, headers=auth(cust_tok), timeout=15)
    bal_before = balance(cust_tok)

    r = S.post(f"/tasks/{task2}/cancel", headers=auth(cust_tok), timeout=15)
    check("POST /tasks/{id}/cancel (заказчик)", r.status_code == 200,
          f"refunded={r.json().get('refunded')}")
    check("Эскроу возвращён", balance(cust_tok) == bal_before + 4000,
          f"balance={balance(cust_tok)}")

    r = S.get(f"/tasks/{task2}", timeout=15)
    check("Заказ в статусе cancelled", r.json()["status"] == "cancelled")

    r = S.post(f"/tasks/{task2}/cancel", headers=auth(cust_tok), timeout=15)
    check("Повторная отмена -> 400", r.status_code == 400)

    r = S.get(f"/wallet/transactions", headers=auth(cust_tok), timeout=15)
    types = [t["type"] for t in r.json()]
    check("В истории есть escrow_refund", "escrow_refund" in types, f"types={sorted(set(types))}")

    # ---------- 5. Сброс пароля (dev-фолбэк) ----------
    print("\n--- Сброс пароля ---")
    r = S.post(f"/auth/forgot-password", json={"email": cust_email}, timeout=15)
    link = r.json().get("dev_reset_link")
    check("POST /auth/forgot-password (dev-ссылка)", r.status_code == 200 and bool(link),
          (link or "")[:50])

    if link:
        token_part = link.split("token=")[-1]
        r = S.post(f"/auth/reset-password",
                          json={"token": token_part, "new_password": "NewPass123"}, timeout=15)
        check("POST /auth/reset-password", r.status_code == 200)

        r = S.post(f"/login",
                          data={"username": cust_email, "password": "Password1"}, timeout=15)
        check("Старый пароль не работает -> 401", r.status_code == 401)
        new_tok = login(cust_email, "NewPass123")
        check("Вход с новым паролем", bool(new_tok))

        r = S.post(f"/auth/reset-password",
                          json={"token": token_part, "new_password": "Another1"}, timeout=15)
        check("Повторное использование токена -> 400", r.status_code == 400)

    # ---------- Итог ----------
    print(f"\n=== РЕЗУЛЬТАТ: {PASSED} passed, {FAILED} failed ===")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
