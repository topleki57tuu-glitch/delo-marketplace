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


async def ws_test(task_id, listener_token, sender_token):
    """Проверяем WebSocket-чат.

    Broadcast уходит в момент POST /messages тем, кто уже подключён,
    поэтому сначала подключаем слушателя, даём соединению устояться,
    и только потом отправляем сообщение вторым участником сделки.
    """
    import websockets

    # Адрес берём из BASE, а не хардкодим localhost:8000 — иначе тест молча
    # проверяет не тот сервер, что указан в DELO_BASE (например, при запуске
    # на другом порту падал с WinError 1225 «соединение отклонено»).
    ws_base = BASE.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")
    uri = f"{ws_base}/ws/tasks/{task_id}?token={listener_token}"
    try:
        async with websockets.connect(uri, open_timeout=5) as ws:
            # Даём серверу зарегистрировать соединение в manager.
            await asyncio.sleep(0.3)

            # POST из async-контекста уводим в отдельный поток: внутри цикла
            # блокирующий запрос может залипнуть (запрос CSRF-токена и т.п.).
            r = await asyncio.to_thread(
                S.post,
                f"/tasks/{task_id}/messages",
                headers=auth(sender_token),
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
    r = S.get(f"/health", timeout=15)
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
    r = S.post(f"/login", data={"username": cust_email, "password": "wrong-pass"}, timeout=15
    )
    check("POST /login wrong password -> 401", r.status_code == 401)

    # ---------- 3. Профиль ----------
    r = S.get(f"/users/me", headers=auth(cust_tok), timeout=15)
    check(
        "GET /users/me (customer)",
        r.status_code == 200 and r.json()["email"] == cust_email,
        f"id={r.json().get('id')}",
    )
    cust_id = r.json()["id"]

    r = S.get(f"/users/me", headers=auth(spec_tok), timeout=15)
    spec_id = r.json()["id"]
    check("GET /users/me (specialist)", r.status_code == 200, f"id={spec_id}")

    r = S.put(f"/users/me",
        headers=auth(spec_tok),
        json={
            "bio": "Опыт 5 лет. Делаю быстро и качественно.",
            "city": "Москва",
            "skills": json.dumps(["Python", "FastAPI", "React"]),
        },
        timeout=15,
    )
    check("PUT /users/me (bio/city/skills)", r.status_code == 200, r.text[:60])

    r = S.get(f"/users/{spec_id}/public", timeout=15)
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
    r = S.post(f"/tasks/", headers=auth(cust_tok), json=task_data, timeout=15)
    check("POST /tasks/ (create)", r.status_code == 200, r.text[:80])
    task_id = r.json()["task_id"]

    r = S.post(f"/tasks/", headers=auth(spec_tok), json=task_data, timeout=15)
    check("POST /tasks/ by specialist -> 403", r.status_code == 403)

    r = S.get(f"/tasks/", timeout=15)
    ok = r.status_code == 200 and any(t["id"] == task_id for t in r.json())
    check("GET /tasks/ (в списке)", ok, f"всего задач: {len(r.json())}")

    r = S.get(f"/tasks/", params={"search": unique}, timeout=15)
    check("GET /tasks/?search=", r.status_code == 200 and len(r.json()) == 1)

    r = S.get(f"/tasks/{task_id}", timeout=15)
    ok = r.status_code == 200 and r.json()["title"] == task_data["title"]
    check("GET /tasks/{id} (detail)", ok)

    r = S.get(f"/tasks/999999", timeout=15)
    check("GET /tasks/999999 -> 404", r.status_code == 404)

    # ---------- 5. Отклик ----------
    resp_data = {
        "text": "Готов сделать за 3 дня, портфолио в профиле.",
        "proposed_price": 4500,
        "estimated_days": 3,
    }
    r = S.post(f"/tasks/{task_id}/responses", headers=auth(spec_tok), json=resp_data, timeout=15
    )
    check(
        "POST /tasks/{id}/responses",
        r.status_code == 200,
        f"credits_left={r.json().get('credits_left')}",
    )
    r = S.post(f"/tasks/{task_id}/responses", headers=auth(cust_tok), json=resp_data, timeout=15
    )
    check("customer respond -> 403", r.status_code == 403)

    r = S.get(f"/tasks/{task_id}/responses", headers=auth(cust_tok), timeout=15)
    ok = r.status_code == 200 and len(r.json()) == 1
    check("GET /tasks/{id}/responses", ok)

    # ---------- 6. Кошелёк и эскроу ----------
    r = S.post(f"/wallet/deposit", headers=auth(cust_tok), json={"amount": 10000}, timeout=15)
    check("POST /wallet/deposit", r.status_code == 200, f"balance={r.json().get('new_balance')}")

    r = S.put(f"/tasks/{task_id}/assign",
        headers=auth(cust_tok),
        params={"specialist_id": spec_id},
        timeout=15,
    )
    check("PUT /tasks/{id}/assign", r.status_code == 200, r.text[:60])

    r = S.get(f"/users/me", headers=auth(cust_tok), timeout=15)
    check(
        "Эскроу: баланс заказчика уменьшился",
        r.json()["balance"] == 10000 - task_data["budget"],
        f"balance={r.json()['balance']}",
    )

    # ---------- 7. Сообщения ----------
    r = S.post(f"/tasks/{task_id}/messages",
        headers=auth(cust_tok),
        json={"text": "Здравствуйте! Когда начнёте?"},
        timeout=15,
    )
    check("POST message (customer)", r.status_code == 200)
    r = S.post(f"/tasks/{task_id}/messages",
        headers=auth(spec_tok),
        json={"text": "Завтра утром приступлю."},
        timeout=15,
    )
    check("POST message (specialist)", r.status_code == 200)
    r = S.get(f"/tasks/{task_id}/messages", headers=auth(cust_tok), timeout=15)
    check("GET messages (customer, 2 шт.)", r.status_code == 200 and len(r.json()) == 2)
    r = S.get(f"/tasks/{task_id}/messages", headers=auth(spec_tok), timeout=15)
    check("GET messages (specialist, 2 шт.)", r.status_code == 200 and len(r.json()) == 2)

    # ---------- 8. Уведомления ----------
    r = S.get(f"/notifications/", headers=auth(cust_tok), timeout=15)
    ok = r.status_code == 200 and r.json()["unread_count"] >= 1
    check("GET /notifications/ (у заказчика new_response)", ok)
    r = S.get(f"/notifications/", headers=auth(spec_tok), timeout=15)
    ok = r.status_code == 200 and any(n["type"] == "assigned" for n in r.json()["notifications"])
    check("GET /notifications/ (у исполнителя assigned)", ok)
    r = S.post(f"/notifications/read-all", headers=auth(cust_tok), timeout=15)
    check("POST /notifications/read-all", r.status_code == 200)

    # ---------- 9. Завершение и отзыв ----------
    r = S.get(f"/users/me", headers=auth(spec_tok), timeout=15)
    spec_balance_before = r.json()["balance"]

    r = S.put(f"/tasks/{task_id}/complete", headers=auth(cust_tok), timeout=15)
    check("PUT /tasks/{id}/complete", r.status_code == 200, r.text[:90])

    r = S.get(f"/users/me", headers=auth(spec_tok), timeout=15)
    # Монетизация: при завершении платформа удерживает 5% (PRO — 0%;
    # PRO покупается ниже по ходу теста, здесь исполнитель ещё обычный)
    expected_fee = round(task_data["budget"] * 0.05)
    expected_payout = task_data["budget"] - expected_fee
    check(
        "Эскроу: бюджет переведён исполнителю за вычетом комиссии 5%",
        r.json()["balance"] == spec_balance_before + expected_payout,
        f"{spec_balance_before} -> {r.json()['balance']} (комиссия {expected_fee})",
    )

    r = S.get(f"/notifications/", headers=auth(spec_tok), timeout=15)
    ok = any(n["type"] == "completed" for n in r.json()["notifications"])
    check("Уведомление исполнителю о завершении", ok)

    r = S.put(f"/tasks/{task_id}/complete", headers=auth(cust_tok), timeout=15)
    check("Повторное завершение -> 400 (нет двойной выплаты)", r.status_code == 400)

    r = S.post(f"/tasks/{task_id}/review",
        headers=auth(cust_tok),
        json={"rating": 5, "comment": "Отличная работа, всё в срок!"},
        timeout=15,
    )
    check("POST /tasks/{id}/review (customer -> specialist)", r.status_code == 200)
    r = S.post(f"/tasks/{task_id}/review",
        headers=auth(cust_tok),
        json={"rating": 4, "comment": "Повторный отзыв"},
        timeout=15,
    )
    check("Повторный отзыв -> 400", r.status_code == 400)

    r = S.get(f"/users/{spec_id}/public", timeout=15)
    check("Публичный профиль: rating=5.0", r.json().get("rating") == 5.0)
    r = S.get(f"/users/{spec_id}/reviews", timeout=15)
    check("GET /users/{id}/reviews (1 отзыв)", r.status_code == 200 and len(r.json()) == 1)

    # ---------- 10. Монетизация ----------
    r = S.get(f"/monetization/packages", timeout=15)
    ok = r.status_code == 200 and len(r.json()["packages"]) == 5
    check("GET /monetization/packages (5 пакетов)", ok)

    r = S.post(f"/wallet/deposit", headers=auth(spec_tok), json={"amount": 5000}, timeout=15)
    check("Пополнение исполнителя", r.status_code == 200)
    r = S.post(f"/monetization/buy", headers=auth(spec_tok), json={"package_id": "pro_1"}, timeout=15
    )
    check("POST /monetization/buy (pro_1)", r.status_code == 200, r.json().get("message", "")[:60])
    r = S.get(f"/users/me", headers=auth(spec_tok), timeout=15)
    check("Исполнитель стал PRO", r.json().get("is_pro") is True)

    # PRO-отклик без списания кредитов — нужен второй заказ
    task2_data = dict(task_data, title=f"{unique} Консультация по SEO", budget=2000)
    r = S.post(f"/tasks/", headers=auth(cust_tok), json=task2_data, timeout=15)
    task2_id = r.json()["task_id"]
    r = S.post(f"/tasks/{task2_id}/responses",
        headers=auth(spec_tok),
        json={"text": "PRO-отклик", "proposed_price": 1800},
        timeout=15,
    )
    ok = r.status_code == 200 and r.json().get("credits_left") is None
    check("PRO-отклик (кредиты не списываются)", ok)

    # ---------- 11. Смена роли ----------
    r = S.post(f"/users/me/switch-role", headers=auth(cust_tok), timeout=15)
    check("POST /users/me/switch-role", r.status_code == 200, r.text[:60])
    r = S.post(f"/users/me/switch-role", headers=auth(cust_tok), timeout=15)
    check("POST /users/me/switch-role (обратно)", r.status_code == 200)

    # ---------- 12. Статус платёжной системы ----------
    r = S.get(f"/payments/status", timeout=15)
    check("GET /payments/status", r.status_code == 200, f"configured={r.json().get('configured')}")

    # ---------- 13. WebSocket ----------
    # Для WS-комнаты нужно участие в сделке: назначаем исполнителя на task2
    # (одного отклика недостаточно — эндпоинт пускает только customer/executor).
    spec_id = S.get(f"/users/me", headers=auth(spec_tok), timeout=15).json()["id"]
    r = S.put(
        f"/tasks/{task2_id}/assign?specialist_id={spec_id}",
        headers=auth(cust_tok),
        timeout=15,
    )
    check("task2: назначение для WS-теста", r.status_code == 200, r.text[:80])

    # Слушатель — заказчик, отправитель — исполнитель.
    asyncio.run(ws_test(task2_id, cust_tok, spec_tok))

    print(f"\n=== ИТОГ: PASSED={PASSED}, FAILED={FAILED} ===")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
