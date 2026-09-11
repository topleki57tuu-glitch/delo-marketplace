#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест новых возможностей:
1. Чат: GET /chats, POST /tasks/{id}/messages, PUT /tasks/{id}/messages/read, статус is_read
2. Отзывы: GET /tasks/{id}/reviews (can_review, has_my_review), POST /tasks/{id}/review, уведомления type=review
3. Уведомления: GET /notifications/, PUT /notifications/{id}/read, POST /notifications/read-all
"""
import time
import requests

BASE = "http://localhost:8000"
TS = int(time.time())

def auth(tok):
    return {"Authorization": f"Bearer {tok}"}

def run():
    print("=== Тестирование чатов, отзывов и уведомлений ===")

    # 1. Регистрация двух пользователей
    c_email = f"chat.cust.{TS}@test.ru"
    s_email = f"chat.spec.{TS}@test.ru"
    pwd = "password123"

    r_c = requests.post(f"{BASE}/register/", json={"email": c_email, "password": pwd, "role": "customer", "name": "Тест Заказчик"})
    r_s = requests.post(f"{BASE}/register/", json={"email": s_email, "password": pwd, "role": "specialist", "name": "Тест Исполнитель"})
    assert r_c.status_code == 200, r_c.text
    assert r_s.status_code == 200, r_s.text

    c_tok = requests.post(f"{BASE}/login", data={"username": c_email, "password": pwd}).json()["access_token"]
    s_tok = requests.post(f"{BASE}/login", data={"username": s_email, "password": pwd}).json()["access_token"]
    print("  OK 1. Регистрация и авторизация заказчика и исполнителя")

    # 2. Пополнение баланса заказчика и создание задания
    requests.post(f"{BASE}/wallet/deposit", json={"amount": 5000}, headers=auth(c_tok))
    t_res = requests.post(f"{BASE}/tasks/", json={
        "title": "Разработка логотипа",
        "description": "Нужен стильный логотип для кофейни",
        "budget": 3000,
        "category": "design"
    }, headers=auth(c_tok))
    task_id = t_res.json()["task_id"]
    print(f"  OK 2. Создано задание id={task_id}")

    # 3. Отклик исполнителя и назначение
    resp_res = requests.post(f"{BASE}/tasks/{task_id}/responses", json={
        "text": "Готов нарисовать 3 варианта логотипа",
        "proposed_price": 3000,
        "estimated_days": 2
    }, headers=auth(s_tok))
    assert resp_res.status_code == 200, resp_res.text

    # Назначение исполнителя (эскроу холд)
    spec_info = requests.get(f"{BASE}/users/me", headers=auth(s_tok)).json()
    spec_id = spec_info["id"]
    assign_res = requests.put(f"{BASE}/tasks/{task_id}/assign?specialist_id={spec_id}", headers=auth(c_tok))
    assert assign_res.status_code == 200, assign_res.text
    print("  OK 3. Исполнитель откликнулся и назначен в работу")

    # 4. Проверка чатов и сообщений
    # Отправка сообщения от заказчика
    m1 = requests.post(f"{BASE}/tasks/{task_id}/messages", json={"text": "Привет! Когда сможешь прислать первые наброски?"}, headers=auth(c_tok))
    assert m1.status_code == 200
    msg_data = m1.json()
    assert msg_data["is_read"] is False

    # Исполнитель проверяет список диалогов /chats
    chats_spec = requests.get(f"{BASE}/chats", headers=auth(s_tok)).json()
    assert len(chats_spec) >= 1
    my_chat = next(c for c in chats_spec if c["task_id"] == task_id)
    assert my_chat["unread_count"] == 1
    assert "наброски" in my_chat["last_message"]
    print("  OK 4. Список /chats возвращает диалог с unread_count=1")

    # Исполнитель открывает сообщения (автоматически прочитывает)
    msgs = requests.get(f"{BASE}/tasks/{task_id}/messages", headers=auth(s_tok)).json()
    assert len(msgs) == 1
    assert msgs[0]["is_read"] is True

    # Проверка, что после открытия unread_count стал 0
    chats_spec_after = requests.get(f"{BASE}/chats", headers=auth(s_tok)).json()
    my_chat_after = next(c for c in chats_spec_after if c["task_id"] == task_id)
    assert my_chat_after["unread_count"] == 0
    print("  OK 5. Сообщения прочитаны и счётчик обнулился")

    # 5. Завершение задания заказчиком
    comp_res = requests.put(f"{BASE}/tasks/{task_id}/complete", headers=auth(c_tok))
    assert comp_res.status_code == 200
    print("  OK 6. Заказ успешно завершён")

    # 6. Проверка взаимных отзывов: GET /tasks/{id}/reviews
    rev_info = requests.get(f"{BASE}/tasks/{task_id}/reviews", headers=auth(c_tok)).json()
    assert rev_info["can_review"] is True
    assert rev_info["has_my_review"] is False

    # Заказчик оставляет отзыв исполнителю
    r_rev = requests.post(f"{BASE}/tasks/{task_id}/review", json={"rating": 5, "comment": "Отличная работа, все в срок!"}, headers=auth(c_tok))
    assert r_rev.status_code == 200

    # Проверяем статус повторного отзыва (должен быть заблокирован)
    rev_info_2 = requests.get(f"{BASE}/tasks/{task_id}/reviews", headers=auth(c_tok)).json()
    assert rev_info_2["can_review"] is False
    assert rev_info_2["has_my_review"] is True
    assert len(rev_info_2["reviews"]) == 1
    print("  OK 7. Отзыв заказчика опубликован и проверен через GET /tasks/{id}/reviews")

    # Исполнитель также оставляет встречный отзыв заказчику
    rev_info_spec = requests.get(f"{BASE}/tasks/{task_id}/reviews", headers=auth(s_tok)).json()
    assert rev_info_spec["can_review"] is True
    r_rev_s = requests.post(f"{BASE}/tasks/{task_id}/review", json={"rating": 5, "comment": "Четкое ТЗ и быстрая оплата!"}, headers=auth(s_tok))
    assert r_rev_s.status_code == 200
    print("  OK 8. Встречный отзыв исполнителя опубликован")

    # 7. Центр уведомлений
    notifs_s = requests.get(f"{BASE}/notifications/", headers=auth(s_tok)).json()
    assert notifs_s["unread_count"] >= 1
    types = [n["type"] for n in notifs_s["notifications"]]
    assert "review" in types
    assert "completed" in types
    assert "message" in types
    print(f"  OK 9. Уведомления доставлены (типы: {set(types)})")

    # Отметка всех прочитанными
    mark_res = requests.post(f"{BASE}/notifications/read-all", headers=auth(s_tok))
    assert mark_res.status_code == 200
    notifs_s_after = requests.get(f"{BASE}/notifications/", headers=auth(s_tok)).json()
    assert notifs_s_after["unread_count"] == 0
    print("  OK 10. Отметка всех уведомлений прочитанными (unread_count = 0)")

    print("\n=== ВСЕ ТЕСТЫ ЧАТОВ, ОТЗЫВОВ И УВЕДОМЛЕНИЙ УСПЕШНО ПРОЙДЕНЫ ===")

if __name__ == "__main__":
    run()
