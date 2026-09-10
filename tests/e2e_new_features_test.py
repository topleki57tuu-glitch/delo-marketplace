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

Примечание: для проверок арбитража нужен аккаунт admin@delo.ru (demo123)
из seed_demo.py и ADMIN_EMAILS=admin@delo.ru в окружении backend.
"""
import json
import time

import requests

BASE = "http://localhost:8000"
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


def register(email, password, role, name):
    return requests.post(
        f"{BASE}/register/",
        json={"email": email, "password": password, "role": role, "name": name},
        timeout=15,
    )


def login(email, password):
    r = requests.post(
        f"{BASE}/login", data={"username": email, "password": password}, timeout=15
    )
    if r.status_code != 200:
        raise RuntimeError(f"login failed: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def balance(token):
    r = requests.get(f"{BASE}/users/me", headers=auth(token), timeout=15)
    return r.json()["balance"]


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
    requests.put(
        f"{BASE}/users/me", headers=auth(spec_tok),
        json={"bio": "Тестовый специалист по дизайну", "city": "Тестбург",
              "skills": json.dumps(["Figma", "UI/UX"])},
        timeout=15,
    )

    r = requests.get(f"{BASE}/specialists/", timeout=15)
    data = r.json()
    check("GET /specialists/ (200, структура)",
          r.status_code == 200 and "items" in data and "total" in data and "pages" in data,
          f"total={data.get('total')}")

    r = requests.get(f"{BASE}/specialists/", params={"search": "Тест Специалист"}, timeout=15)
    data = r.json()
    check("GET /specialists/?search= (по имени)",
          r.status_code == 200 and any(s["name"] == "Тест Специалист" for s in data["items"]),
          f"total={data.get('total')}")

    r = requests.get(f"{BASE}/specialists/", params={"city": "Тестбург"}, timeout=15)
    data = r.json()
    check("GET /specialists/?city= (фильтр по городу)",
          r.status_code == 200 and data["total"] >= 1
          and all("Тестбург" in (s.get("city") or "") for s in data["items"]))

    r = requests.get(f"{BASE}/specialists/", params={"per_page": 2, "page": 1}, timeout=15)
    d1 = r.json()
    r2 = requests.get(f"{BASE}/specialists/", params={"per_page": 2, "page": 2}, timeout=15)
    d2 = r2.json()
    check("GET /specialists/ (пагинация)",
          len(d1["items"]) <= 2 and d1["pages"] >= 1
          and (d1["pages"] == 1 or d1["items"][0]["id"] != d2["items"][0]["id"]),
          f"pages={d1['pages']}")

    for sort in ("rating", "completed", "reviews", "newest"):
        r = requests.get(f"{BASE}/specialists/", params={"sort": sort}, timeout=15)
        check(f"GET /specialists/?sort={sort}", r.status_code == 200)

    r = requests.get(f"{BASE}/specialists/", params={"sort": "wrong"}, timeout=15)
    check("GET /specialists/?sort=wrong -> 422", r.status_code == 422)

    # ---------- 2. История транзакций + CSV ----------
    print("\n--- История транзакций и CSV ---")
    r = requests.post(f"{BASE}/wallet/deposit", headers=auth(cust_tok),
                      json={"amount": 20000}, timeout=15)
    check("POST /wallet/deposit (+20000)", r.status_code == 200)

    r = requests.get(f"{BASE}/wallet/transactions", headers=auth(cust_tok), timeout=15)
    txs = r.json()
    check("GET /wallet/transactions", r.status_code == 200 and len(txs) >= 1
          and txs[0]["type"] == "deposit" and txs[0]["amount"] == 20000,
          f"txs={len(txs)}")

    r = requests.get(f"{BASE}/wallet/transactions.csv", headers=auth(cust_tok), timeout=15)
    body = r.content.decode("utf-8")
    check("GET /wallet/transactions.csv",
          r.status_code == 200 and "text/csv" in r.headers.get("Content-Type", "")
          and "Пополнение" in body and "20000" in body,
          f"строк: {len(body.strip().splitlines())}")

    r = requests.get(f"{BASE}/wallet/transactions.csv", timeout=15)
    check("CSV без токена -> 401/403", r.status_code in (401, 403))

    # ---------- 3. Спор и арбитраж ----------
    print("\n--- Споры и арбитраж ---")
    # Заказ №1: назначение -> спор -> арбитраж (возврат заказчику)
    r = requests.post(f"{BASE}/tasks/", headers=auth(cust_tok), json={
        "title": f"DISPUTE-{TS} Дизайн логотипа", "description": "Нужен логотип.",
        "budget": 7000, "category": "design", "is_remote": True,
    }, timeout=15)
    task1 = r.json()["task_id"]

    cust_id = requests.get(f"{BASE}/users/me", headers=auth(cust_tok), timeout=15).json()["id"]
    spec_id = requests.get(f"{BASE}/users/me", headers=auth(spec_tok), timeout=15).json()["id"]

    requests.post(f"{BASE}/tasks/{task1}/responses", headers=auth(spec_tok),
                  json={"text": "Сделаю!"}, timeout=15)
    r = requests.put(f"{BASE}/tasks/{task1}/assign",
                     params={"specialist_id": spec_id}, headers=auth(cust_tok), timeout=15)
    check("PUT /tasks/{id}/assign (эскроу-холд)", r.status_code == 200)
    check("Баланс заказчика после холда", balance(cust_tok) == 20000 - 7000,
          f"balance={balance(cust_tok)}")

    r = requests.post(f"{BASE}/tasks/{task1}/dispute", headers=auth(spec_tok),
                      json={"reason": "Заказчик не предоставляет исходные материалы неделю."},
                      timeout=15)
    check("POST /tasks/{id}/dispute (спор открыт)", r.status_code == 200, r.text[:60])

    r = requests.post(f"{BASE}/tasks/{task1}/dispute", headers=auth(cust_tok),
                      json={"reason": "Повторный спор"}, timeout=15)
    check("Повторный спор -> 400", r.status_code == 400)

    r = requests.get(f"{BASE}/tasks/{task1}", timeout=15)
    check("Заказ в статусе disputed", r.json()["status"] == "disputed")

    r = requests.put(f"{BASE}/tasks/{task1}/complete", headers=auth(cust_tok), timeout=15)
    check("Завершение при споре -> 400", r.status_code == 400)

    r = requests.get(f"{BASE}/tasks/{task1}/dispute", headers=auth(cust_tok), timeout=15)
    d = r.json().get("dispute")
    check("GET /tasks/{id}/dispute (участник видит спор)",
          r.status_code == 200 and d and d["status"] == "open" and d["opened_by"] == spec_id)
    dispute1 = d["id"]

    # Отмена не инициатором спора запрещена
    r = requests.post(f"{BASE}/tasks/{task1}/cancel", headers=auth(cust_tok), timeout=15)
    check("Отмена заказчиком при чужом споре -> 403", r.status_code == 403)

    # Арбитраж
    try:
        admin_tok = login("admin@delo.ru", "demo123")
    except RuntimeError:
        admin_tok = None
    check("Арбитр admin@delo.ru доступен (seed)", bool(admin_tok))

    if admin_tok:
        r = requests.get(f"{BASE}/admin/disputes", headers=auth(cust_tok), timeout=15)
        check("GET /admin/disputes не-админом -> 403", r.status_code == 403)

        r = requests.get(f"{BASE}/admin/disputes", headers=auth(admin_tok), timeout=15)
        lst = r.json()
        check("GET /admin/disputes (арбитр)",
              r.status_code == 200 and any(x["id"] == dispute1 for x in lst["disputes"]),
              f"open={lst.get('count')}")

        r = requests.post(f"{BASE}/admin/disputes/{dispute1}/resolve",
                          headers=auth(admin_tok),
                          json={"decision": "refund_customer", "comment": "Работа не начата, возврат."},
                          timeout=15)
        check("POST /admin/disputes/{id}/resolve (refund)", r.status_code == 200, r.text[:70])
        check("Баланс заказчика после возврата", balance(cust_tok) == 20000,
              f"balance={balance(cust_tok)}")

        r = requests.get(f"{BASE}/tasks/{task1}", timeout=15)
        check("Заказ отменён после refund", r.json()["status"] == "cancelled")

        r = requests.post(f"{BASE}/admin/disputes/{dispute1}/resolve",
                          headers=auth(admin_tok),
                          json={"decision": "pay_specialist"}, timeout=15)
        check("Повторное решение спора -> 400", r.status_code == 400)

    # ---------- 4. Отмена назначения с возвратом эскроу ----------
    print("\n--- Отмена назначения (возврат эскроу) ---")
    r = requests.post(f"{BASE}/tasks/", headers=auth(cust_tok), json={
        "title": f"CANCEL-{TS} Монтаж видео", "description": "Смонтировать ролик.",
        "budget": 4000, "category": "photo_video", "is_remote": True,
    }, timeout=15)
    task2 = r.json()["task_id"]
    requests.post(f"{BASE}/tasks/{task2}/responses", headers=auth(spec_tok),
                  json={"text": "Возьмусь."}, timeout=15)
    requests.put(f"{BASE}/tasks/{task2}/assign",
                 params={"specialist_id": spec_id}, headers=auth(cust_tok), timeout=15)
    bal_before = balance(cust_tok)

    r = requests.post(f"{BASE}/tasks/{task2}/cancel", headers=auth(cust_tok), timeout=15)
    check("POST /tasks/{id}/cancel (заказчик)", r.status_code == 200,
          f"refunded={r.json().get('refunded')}")
    check("Эскроу возвращён", balance(cust_tok) == bal_before + 4000,
          f"balance={balance(cust_tok)}")

    r = requests.get(f"{BASE}/tasks/{task2}", timeout=15)
    check("Заказ в статусе cancelled", r.json()["status"] == "cancelled")

    r = requests.post(f"{BASE}/tasks/{task2}/cancel", headers=auth(cust_tok), timeout=15)
    check("Повторная отмена -> 400", r.status_code == 400)

    r = requests.get(f"{BASE}/wallet/transactions", headers=auth(cust_tok), timeout=15)
    types = [t["type"] for t in r.json()]
    check("В истории есть escrow_refund", "escrow_refund" in types, f"types={sorted(set(types))}")

    # ---------- 5. Сброс пароля (dev-фолбэк) ----------
    print("\n--- Сброс пароля ---")
    r = requests.post(f"{BASE}/auth/forgot-password", json={"email": cust_email}, timeout=15)
    link = r.json().get("dev_reset_link")
    check("POST /auth/forgot-password (dev-ссылка)", r.status_code == 200 and bool(link),
          (link or "")[:50])

    if link:
        token_part = link.split("token=")[-1]
        r = requests.post(f"{BASE}/auth/reset-password",
                          json={"token": token_part, "new_password": "NewPass123"}, timeout=15)
        check("POST /auth/reset-password", r.status_code == 200)

        r = requests.post(f"{BASE}/login",
                          data={"username": cust_email, "password": "Password1"}, timeout=15)
        check("Старый пароль не работает -> 401", r.status_code == 401)
        new_tok = login(cust_email, "NewPass123")
        check("Вход с новым паролем", bool(new_tok))

        r = requests.post(f"{BASE}/auth/reset-password",
                          json={"token": token_part, "new_password": "Another1"}, timeout=15)
        check("Повторное использование токена -> 400", r.status_code == 400)

    # ---------- Итог ----------
    print(f"\n=== РЕЗУЛЬТАТ: {PASSED} passed, {FAILED} failed ===")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
