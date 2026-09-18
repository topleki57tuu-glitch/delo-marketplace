#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Регресс: вложения в чате — ссылка на файл, а не его содержимое.

Что защищается. Раньше `MessageCreate.file_url` не имел ограничения длины,
а фронтенд клал туда data-URL целиком (`FileReader.readAsDataURL`): файл на
1.5 МБ становился 1.5 МБ base64 внутри строки БД, и столько же приезжало на
каждое чтение чата. Замер до фикса:

    POST /messages с вложением 1,500,023 симв. -> 200
    GET /tasks/N/messages -> 200, размер ответа 1,500,247 байт
    после второго вложения -> 3,000,495 байт (+1,500,248)

Ответ рос линейно от числа картинок в переписке, и то же самое уходило
каждому клиенту через WebSocket. Это тот же дефект, что уже починили в
аватаре (коммит 5ea57d2), но в чате он остался.

Теперь вложение сначала загружается в `/upload/image`, а в сообщении едет
короткая ссылка `/files/<id>`; серверная схема отвергает base64.

Отдельно проверяются даты в ответах (пункт 5). `MessageOut.created_at` и
`ChatDialogOut.last_message_time` объявлены как `str`, а эндпоинты возвращали
datetime. Это не всплывало только потому, что у них нет `response_model`, —
сериализатор приводил значение сам. Но список чатов сортируется по
`last_message_time`, и datetime вперемешку с `""` от диалога без сообщений
даёт TypeError: заказчик с двумя задачами, где переписка только в одной,
получал 500 на `GET /chats`.

Коды возврата: 0 — защита на месте, 1 — дефект вернулся.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import Session  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://127.0.0.1:8000")
PASSWORD = os.environ.get("DEMO_PASSWORD", "AuditPass_2026x")

JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300ff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffc2000b080001000101011100ff"
    "c4001f0000010501010101010100000000000000000102030405"
    "060708090a0bffc400b510000201030302040305050404000001"
    "7d01020300041105122131410613516107227114328191a10823"
    "42b1c11552d1f02433627282090a161718191a25262728292a34"
    "35363738393a434445464748494a535455565758595a63646566"
    "6768696a737475767778797a838485868788898a929394959697"
    "98999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5"
    "c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1"
    "f2f3f4f5f6f7f8f9faffda0008010100003f00f9ffd9"
)

_failed = 0


def check(name, condition, detail=""):
    global _failed
    if condition:
        print(f"  OK   {name}" + (f" | {detail}" if detail else ""))
    else:
        _failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


def main() -> int:
    print("=== Вложения в чате ===\n")

    customer = Session(BASE)
    ctok = customer.login("anna@delo.ru", PASSWORD)

    # Нужна сделка, где anna — заказчик и уже есть исполнитель: у чужой сделки
    # чат вернёт 403, и тест проверял бы доступ вместо вложений.
    me = customer.get("/users/me", headers=customer.auth(ctok)).json()
    tasks = customer.get("/tasks/?limit=50").json()
    items = tasks.get("items", tasks) if isinstance(tasks, dict) else tasks
    task_id = None
    for t in (items if isinstance(items, list) else []):
        if t.get("executor_id") and t.get("customer_id") == me["id"]:
            task_id = t["id"]
            break

    if task_id is None:
        r = customer.post(
            "/tasks/",
            json={"title": "Проба вложения", "description": "проверка",
                  "budget": 100, "category": "development"},
            headers=customer.auth(ctok),
        )
        if r.status_code != 200:
            print(f"не удалось создать задачу: {r.status_code} {r.text[:200]}")
            return 2
        task_id = r.json()["task_id"]

        spec = Session(BASE)
        stok = spec.login("maria@delo.ru", PASSWORD)
        me = spec.get("/users/me", headers=spec.auth(stok)).json()
        r = customer.put(
            f"/tasks/{task_id}/assign?specialist_id={me['id']}",
            headers=customer.auth(ctok),
        )
        if r.status_code != 200:
            print(f"не удалось назначить исполнителя: {r.status_code} {r.text[:200]}")
            return 2

    print(f"  сделка id={task_id}\n")

    # --- 1. base64 в поле вложения отклоняется -----------------------------
    big_base64 = "data:image/jpeg;base64," + ("A" * 1_500_000)
    r = customer.post(
        f"/tasks/{task_id}/messages",
        json={"text": "📎 big.jpg", "file_url": big_base64,
              "file_name": "big.jpg", "file_type": "image/jpeg"},
        headers=customer.auth(ctok),
    )
    check("base64 в file_url отклонён", r.status_code == 422,
          f"{r.status_code} (ожидалось 422)")
    check("ошибка объясняет, что делать", "upload/image" in r.text,
          "" if "upload/image" in r.text else "нет подсказки про /upload/image")

    # --- 2. Короткая внутренняя ссылка принимается ------------------------
    up = customer.post(
        "/upload/image?scope=private",
        files={"file": ("chat.jpg", io.BytesIO(JPEG), "image/jpeg")},
        headers=customer.auth(ctok),
    )
    if up.status_code != 200:
        print(f"  загрузка не удалась: {up.status_code} {up.text[:200]}")
        return 2
    file_url = up.json()["url"]

    r = customer.post(
        f"/tasks/{task_id}/messages",
        json={"text": "📎 chat.jpg", "file_url": file_url,
              "file_name": "chat.jpg", "file_type": "image/jpeg"},
        headers=customer.auth(ctok),
    )
    check("ссылка /files/<id> принята", r.status_code == 200, f"{r.status_code}")

    # --- 3. Размер ответа не растёт от размера вложений --------------------
    def messages_size():
        resp = customer.get(f"/tasks/{task_id}/messages", headers=customer.auth(ctok))
        return len(resp.content), resp.json()

    before, _ = messages_size()

    for i in range(2):
        customer.post(
            f"/tasks/{task_id}/messages",
            json={"text": f"📎 p{i}.jpg", "file_url": file_url,
                  "file_name": f"p{i}.jpg", "file_type": "image/jpeg"},
            headers=customer.auth(ctok),
        )

    after, msgs = messages_size()
    growth = after - before
    check("ответ чата не вырос на размер вложений", growth < 2000,
          f"прирост {growth:,} байт (ожидалось < 2000)")

    # --- 4. Ссылки в ответе подписаны --------------------------------------
    attached = [m for m in msgs if (m.get("file_url") or "").startswith("/files/")]
    signed = [m for m in attached if "token=" in m["file_url"]]
    check("ссылки на вложения подписаны", len(signed) == len(attached) and attached,
          f"{len(signed)} из {len(attached)}")

    # --- 5. Даты в ответах — строки, а не объекты --------------------------
    # `MessageOut.created_at` и `ChatDialogOut.last_message_time` объявлены
    # как `str`. Пока эндпоинты возвращали datetime, это не всплывало: у них
    # нет `response_model`, и сериализатор молча приводил значение сам. Но
    # список чатов сортируется по `last_message_time`, и datetime вперемешку
    # с `""` от диалога без сообщений даёт TypeError — весь список падал 500.
    # Достаточно заказчика с двумя задачами, где переписка только в одной.
    created = [m.get("created_at") for m in msgs]
    check("created_at в сообщениях — строка",
          created and all(isinstance(v, str) for v in created),
          f"типы: {sorted({type(v).__name__ for v in created})}")

    empty = customer.post(
        "/tasks/",
        json={"title": "Задача без переписки", "description": "проверка списка чатов",
              "budget": 100, "category": "development"},
        headers=customer.auth(ctok),
    )
    if empty.status_code != 200:
        check("создана задача без переписки", False, f"{empty.status_code}")
    else:
        r = customer.get("/chats", headers=customer.auth(ctok))
        check("список чатов не падает при пустом диалоге", r.status_code == 200,
              f"{r.status_code} {r.text[:120]}")
        if r.status_code == 200:
            chats = r.json()
            times = [c.get("last_message_time") for c in chats]
            check("last_message_time — строка или null",
                  all(v is None or isinstance(v, str) for v in times),
                  f"типы: {sorted({type(v).__name__ for v in times})}")
            check("диалог без переписки попал в список с null",
                  any(c.get("task_id") == empty.json()["task_id"]
                      and c.get("last_message_time") is None for c in chats),
                  f"задач в списке: {len(chats)}")

    print(f"\n=== ИТОГ: failed={_failed} ===")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
