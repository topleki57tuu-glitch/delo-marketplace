#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
E2E smoke-тест API маркетплейса «ДЕЛО».

Запускать при работающем backend (uvicorn на :8000):
    python3 tests/e2e_api_test.py

Покрывает: регистрацию, вход, профиль, создание задания, отклик,
кошелёк/эскроу, назначение исполнителя, чат (REST + WebSocket),
уведомления, завершение, отзывы, монетизацию (PRO), смену роли.
"""
import asyncio
import json
import sys
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


async def ws_test(task_id, token):
    """Проверяем WebSocket-чат: подключаемся и ждём broadcast после POST /messages."""
    import websockets

    uri = f"ws://localhost:8000/ws/tasks/{task_id}?token={token}"
    try:
        async with websockets.connect(uri, open_timeout=5) as ws:
            r = requests.post(
                f"{BASE}/tasks/{task_id}/messages",
                headers=auth(token),
                json={"text": "ws-test-broadcast"},
                timeout=15,
            )
            if r.status_code != 200:
                check("WS: сообщение не отправилось", False, r.text[:100])
                return
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(raw)
                check(
                    "WS broadcast получен",
                    data.get("text") == "ws-test-broadcast",
                    f"msg_id={data.get('id')}",
                )
            except asyncio.TimeoutError:
                check("WS broadcast получен", False, "timeout 5s")
    except Exception as e:  # noqa: BLE001
        check("WS connect", False, str(e)[:120])


def main():
    print("=== E2E: ДЕЛО Marketplace API ===")
    print(f"BASE = {BASE}\n")

    # ---------- 0. Доступность ----------
    r = requests.get(f"{BASE}/health", timeout=15)
    check("GET /health", r.status_code == 200, r.json().get("status"))

    # ---------- 1. Регистрация ----------
    cust_email = f"e2e.customer.{TS}@test.ru"
    spec_email = f"e2e.specialist.{TS}@test.ru"

    r = register(cust_email, "Password1", "customer", "Ева Заказчик")
    check("POST /register/ (customer)", r.status_code == 200, r.text[:80])
    r = register(spec_email, "Password1", "specialist", "Марк Специалист")
    check("POST /register/ (specialist)", r.status_code == 200, r.text[:80])
    r = register(cust_email, "Password1", "customer", "Дубликат")
    check("POST /register/ duplicate -> 400", r.status_code == 400, r.text[:60])

    # ---------- 2. Логин ----------
    cust_tok = login(cust_email, "Password1")
    spec_tok = login(spec_email, "Password1")
    check("POST /login (customer)", bool(cust_tok))
    check("POST /login (specialist)", bool(spec_tok))
    r = requests.post(
        f"{BASE}/login", data={"username": cust_email, "password": "wrong-pass"}, timeout=15
    )
    check("POST /login wrong password -> 401", r.status_code == 401)

    # ---------- 3. Профиль ----------
    r = requests.get(f"{BASE}/users/me", headers=auth(cust_tok), timeout=15)
    check(
        "GET /users/me (customer)",
        r.status_code == 200 and r.json()["email"] == cust_email,
        f"id={r.json().get('id')}",
    )
    cust_id = r.json()["id"]

    r = requests.get(f"{BASE}/users/me", headers=auth(spec_tok), timeout=15)
    spec_id = r.json()["id"]
    check("GET /users/me (specialist)", r.status_code == 200, f"id={spec_id}")

    r = requests.put(
        f"{BASE}/users/me",
        headers=auth(spec_tok),
        json={
            "bio": "Опыт 5 лет. Делаю быстро и качественно.",
            "city": "Москва",
            "skills": json.dumps(["Python", "FastAPI", "React"]),
        },
        timeout=15,
    )
    check("PUT /users/me (bio/city/skills)", r.status_code == 200, r.text[:60])

    r = requests.get(f"{BASE}/users/{spec_id}/public", timeout=15)
    check("GET /users/{id}/public", r.status_code == 200 and r.json()["city"] == "Москва")

    # ---------- 4. Задание ----------
    unique = f"E2E-{TS}"
    task_data = {
        "title": f"{unique} Разработать лендинг на React",
        "description": "Нужен одностраничный сайт для кофейни: 4 блока, адаптив, форма заявки.",
        "budget": 5000,
        "category": "development",
        "city": "Москва",
        "address": "ул. Тверская, 1",
        "latitude": 55.7558,
        "longitude": 37.6173,
        "deadline": "2026-09-20",
        "is_remote": True,
    }
    r = requests.post(f"{BASE}/tasks/", headers=auth(cust_tok), json=task_data, timeout=15)
    check("POST /tasks/ (create)", r.status_code == 200, r.text[:80])
    task_id = r.json()["task_id"]

    r = requests.post(f"{BASE}/tasks/", headers=auth(spec_tok), json=task_data, timeout=15)
    check("POST /tasks/ by specialist -> 403", r.status_code == 403)

    r = requests.get(f"{BASE}/tasks/", timeout=15)
    ok = r.status_code == 200 and any(t["id"] == task_id for t in r.json())
    check("GET /tasks/ (в списке)", ok, f"всего задач: {len(r.json())}")

    r = requests.get(f"{BASE}/tasks/", params={"search": unique}, timeout=15)
    check("GET /tasks/?search=", r.status_code == 200 and len(r.json()) == 1)

    r = requests.get(f"{BASE}/tasks/{task_id}", timeout=15)
    ok = r.status_code == 200 and r.json()["title"] == task_data["title"]
    check("GET /tasks/{id} (detail)", ok)

    r = requests.get(f"{BASE}/tasks/999999", timeout=15)
    check("GET /tasks/999999 -> 404", r.status_code == 404)

    # ---------- 5. Отклик ----------
    resp_data = {
        "text": "Готов сделать за 3 дня, портфолио в профиле.",
        "proposed_price": 4500,
        "estimated_days": 3,
    }
    r = requests.post(
        f"{BASE}/tasks/{task_id}/responses", headers=auth(spec_tok), json=resp_data, timeout=15
    )
    check(
        "POST /tasks/{id}/responses",
        r.status_code == 200,
        f"credits_left={r.json().get('credits_left')}",
    )
    r = requests.post(
        f"{BASE}/tasks/{task_id}/responses", headers=auth(cust_tok), json=resp_data, timeout=15
    )
    check("customer respond -> 403", r.status_code == 403)

    r = requests.get(f"{BASE}/tasks/{task_id}/responses", headers=auth(cust_tok), timeout=15)
    ok = r.status_code == 200 and len(r.json()) == 1
    check("GET /tasks/{id}/responses", ok)

    # ---------- 6. Кошелёк и эскроу ----------
    r = requests.post(f"{BASE}/wallet/deposit", headers=auth(cust_tok), json={"amount": 10000}, timeout=15)
    check("POST /wallet/deposit", r.status_code == 200, f"balance={r.json().get('new_balance')}")

    r = requests.put(
        f"{BASE}/tasks/{task_id}/assign",
        headers=auth(cust_tok),
        params={"specialist_id": spec_id},
        timeout=15,
    )
    check("PUT /tasks/{id}/assign", r.status_code == 200, r.text[:60])

    r = requests.get(f"{BASE}/users/me", headers=auth(cust_tok), timeout=15)
    check(
        "Эскроу: баланс заказчика уменьшился",
        r.json()["balance"] == 10000 - task_data["budget"],
        f"balance={r.json()['balance']}",
    )

    # ---------- 7. Сообщения ----------
    r = requests.post(
        f"{BASE}/tasks/{task_id}/messages",
        headers=auth(cust_tok),
        json={"text": "Здравствуйте! Когда начнёте?"},
        timeout=15,
    )
    check("POST message (customer)", r.status_code == 200)
    r = requests.post(
        f"{BASE}/tasks/{task_id}/messages",
        headers=auth(spec_tok),
        json={"text": "Завтра утром приступлю."},
        timeout=15,
    )
    check("POST message (specialist)", r.status_code == 200)
    r = requests.get(f"{BASE}/tasks/{task_id}/messages", headers=auth(cust_tok), timeout=15)
    check("GET messages (customer, 2 шт.)", r.status_code == 200 and len(r.json()) == 2)
    r = requests.get(f"{BASE}/tasks/{task_id}/messages", headers=auth(spec_tok), timeout=15)
    check("GET messages (specialist, 2 шт.)", r.status_code == 200 and len(r.json()) == 2)

    # ---------- 8. Уведомления ----------
    r = requests.get(f"{BASE}/notifications/", headers=auth(cust_tok), timeout=15)
    ok = r.status_code == 200 and r.json()["unread_count"] >= 1
    check("GET /notifications/ (у заказчика new_response)", ok)
    r = requests.get(f"{BASE}/notifications/", headers=auth(spec_tok), timeout=15)
    ok = r.status_code == 200 and any(n["type"] == "assigned" for n in r.json()["notifications"])
    check("GET /notifications/ (у исполнителя assigned)", ok)
    r = requests.post(f"{BASE}/notifications/read-all", headers=auth(cust_tok), timeout=15)
    check("POST /notifications/read-all", r.status_code == 200)

    # ---------- 9. Завершение и отзыв ----------
    r = requests.get(f"{BASE}/users/me", headers=auth(spec_tok), timeout=15)
    spec_balance_before = r.json()["balance"]

    r = requests.put(f"{BASE}/tasks/{task_id}/complete", headers=auth(cust_tok), timeout=15)
    check("PUT /tasks/{id}/complete", r.status_code == 200, r.text[:90])

    r = requests.get(f"{BASE}/users/me", headers=auth(spec_tok), timeout=15)
    check(
        "Эскроу: бюджет переведён исполнителю",
        r.json()["balance"] == spec_balance_before + task_data["budget"],
        f"{spec_balance_before} -> {r.json()['balance']}",
    )

    r = requests.get(f"{BASE}/notifications/", headers=auth(spec_tok), timeout=15)
    ok = any(n["type"] == "completed" for n in r.json()["notifications"])
    check("Уведомление исполнителю о завершении", ok)

    r = requests.put(f"{BASE}/tasks/{task_id}/complete", headers=auth(cust_tok), timeout=15)
    check("Повторное завершение -> 400 (нет двойной выплаты)", r.status_code == 400)

    r = requests.post(
        f"{BASE}/tasks/{task_id}/review",
        headers=auth(cust_tok),
        json={"rating": 5, "comment": "Отличная работа, всё в срок!"},
        timeout=15,
    )
    check("POST /tasks/{id}/review (customer -> specialist)", r.status_code == 200)
    r = requests.post(
        f"{BASE}/tasks/{task_id}/review",
        headers=auth(cust_tok),
        json={"rating": 4, "comment": "Повторный отзыв"},
        timeout=15,
    )
    check("Повторный отзыв -> 400", r.status_code == 400)

    r = requests.get(f"{BASE}/users/{spec_id}/public", timeout=15)
    check("Публичный профиль: rating=5.0", r.json().get("rating") == 5.0)
    r = requests.get(f"{BASE}/users/{spec_id}/reviews", timeout=15)
    check("GET /users/{id}/reviews (1 отзыв)", r.status_code == 200 and len(r.json()) == 1)

    # ---------- 10. Монетизация ----------
    r = requests.get(f"{BASE}/monetization/packages", timeout=15)
    ok = r.status_code == 200 and len(r.json()["packages"]) == 5
    check("GET /monetization/packages (5 пакетов)", ok)

    r = requests.post(f"{BASE}/wallet/deposit", headers=auth(spec_tok), json={"amount": 5000}, timeout=15)
    check("Пополнение исполнителя", r.status_code == 200)
    r = requests.post(
        f"{BASE}/monetization/buy", headers=auth(spec_tok), json={"package_id": "pro_1"}, timeout=15
    )
    check("POST /monetization/buy (pro_1)", r.status_code == 200, r.json().get("message", "")[:60])
    r = requests.get(f"{BASE}/users/me", headers=auth(spec_tok), timeout=15)
    check("Исполнитель стал PRO", r.json().get("is_pro") is True)

    # PRO-отклик без списания кредитов — нужен второй заказ
    task2_data = dict(task_data, title=f"{unique} Консультация по SEO", budget=2000)
    r = requests.post(f"{BASE}/tasks/", headers=auth(cust_tok), json=task2_data, timeout=15)
    task2_id = r.json()["task_id"]
    r = requests.post(
        f"{BASE}/tasks/{task2_id}/responses",
        headers=auth(spec_tok),
        json={"text": "PRO-отклик", "proposed_price": 1800},
        timeout=15,
    )
    ok = r.status_code == 200 and r.json().get("credits_left") is None
    check("PRO-отклик (кредиты не списываются)", ok)

    # ---------- 11. Смена роли ----------
    r = requests.post(f"{BASE}/users/me/switch-role", headers=auth(cust_tok), timeout=15)
    check("POST /users/me/switch-role", r.status_code == 200, r.text[:60])
    r = requests.post(f"{BASE}/users/me/switch-role", headers=auth(cust_tok), timeout=15)
    check("POST /users/me/switch-role (обратно)", r.status_code == 200)

    # ---------- 12. Статус платёжной системы ----------
    r = requests.get(f"{BASE}/payments/status", timeout=15)
    check("GET /payments/status", r.status_code == 200, f"configured={r.json().get('configured')}")

    # ---------- 13. WebSocket ----------
    asyncio.run(ws_test(task2_id, cust_tok))

    print(f"\n=== ИТОГ: PASSED={PASSED}, FAILED={FAILED} ===")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
