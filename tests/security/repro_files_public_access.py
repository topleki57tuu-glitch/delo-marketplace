#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Регресс: доступ к файлам.

Что защищается:

  1. Публичный файл (аватар, фото задания) отдаётся по прямой ссылке —
     иначе не работал бы `<img src="/files/N">`.
  2. Приватный файл (вложение личного чата) без подписи не отдаётся.
     Раньше `GET /files/{id}` был публичным, а `id` — последовательным целым,
     поэтому содержимое перебиралось от 1: анонимный `GET /files/1` возвращал
     200 и байты файла.
  3. Приватный файл с подписью отдаётся, а без неё — нет.
  4. Документ отдаётся только как `attachment` (иначе загруженный под именем
     `.pdf` HTML исполнился бы в браузере — stored XSS).
  5. Удалить чужой файл нельзя.

Коды возврата: 0 — защита на месте, 1 — дефект вернулся.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _helpers import Session, demo_password  # noqa: E402

import requests  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://127.0.0.1:8000")
# Пароль резолвится общим хелпером (DEMO_PASSWORD или backend/demo_password.txt).
# Раньше здесь стоял фолбэк-литерал «AuditPass_2026x» из сессии аудита: вне CI
# набор падал на входе с 401, и симптом выглядел как дефект авторизации.
PASSWORD = demo_password()

# Минимальный валидный JPEG (1x1) — важен только magic bytes.
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

# Минимальный PDF — важен только заголовок %PDF.
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"

_failed = 0


def check(name, condition, detail=""):
    global _failed
    if condition:
        print(f"  OK   {name}" + (f" | {detail}" if detail else ""))
    else:
        _failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


def anon():
    s = requests.Session()
    s.trust_env = False
    return s


def upload(session, scope, name="photo.jpg"):
    return session.post(
        f"/upload/image?scope={scope}",
        files={"file": (name, io.BytesIO(JPEG), "image/jpeg")},
    )


def main() -> int:
    print("=== Доступ к файлам ===\n")

    owner = Session(BASE)
    owner._s.headers["Authorization"] = f"Bearer {owner.login('anna@delo.ru', PASSWORD)}"

    other = Session(BASE)
    other._s.headers["Authorization"] = f"Bearer {other.login('maria@delo.ru', PASSWORD)}"

    # --- 1. Публичный файл -------------------------------------------------
    r = upload(owner, "public")
    if r.status_code != 200:
        print(f"  публичная загрузка не удалась: {r.status_code} {r.text[:200]}")
        return 2
    public_url = r.json()["url"]
    public_id = r.json()["file_id"]
    r = anon().get(f"{BASE}{public_url}", timeout=10)
    check("публичный файл отдаётся анонимно",
          r.status_code == 200 and r.content == JPEG, f"{r.status_code}, {len(r.content)} байт")

    # --- 2. Приватный файл без подписи -------------------------------------
    r = upload(owner, "private", name="secret.jpg")
    if r.status_code != 200:
        print(f"  приватная загрузка не удалась: {r.status_code} {r.text[:200]}")
        return 2
    private_id = r.json()["file_id"]
    private_url = r.json()["url"]

    r = anon().get(f"{BASE}{private_url}", timeout=10)
    check("приватный файл без подписи закрыт", r.status_code == 403,
          f"{r.status_code} (ожидалось 403)")

    # Перебор соседних id не должен открывать ничего, кроме уже известных
    # публичных файлов. Раньше именно этот перебор и давал утечку: анонимный
    # GET /files/1 возвращал 200 и байты чужого файла.
    leaked = []
    for probe_id in range(max(1, private_id - 2), private_id + 3):
        if probe_id == public_id:
            continue  # он публичный по назначению
        rr = anon().get(f"{BASE}/files/{probe_id}", timeout=10)
        if rr.status_code == 200 and rr.content == JPEG:
            leaked.append(probe_id)
    check("перебор id не открывает приватный файл", not leaked,
          f"утекло: {leaked}" if leaked else "")

    # --- 3. Приватный файл с подписью --------------------------------------
    # Нужна сделка, где anna — заказчик: у чужой сделки чат вернёт 403,
    # и проверка подписи превратилась бы в проверку доступа.
    me = owner.get("/users/me").json()
    tasks = owner.get("/tasks/?limit=50").json()
    items = tasks.get("items", tasks) if isinstance(tasks, dict) else tasks
    chat_task = None
    for t in (items if isinstance(items, list) else []):
        if t.get("executor_id") and t.get("customer_id") == me["id"]:
            chat_task = t["id"]
            break

    if chat_task:
        up = upload(owner, "private", name="chat.jpg")
        owner.post(
            f"/tasks/{chat_task}/messages",
            json={"text": "вложение", "file_url": up.json()["url"],
                  "file_name": "chat.jpg", "file_type": "image/jpeg"},
        )
        msgs = owner.get(f"/tasks/{chat_task}/messages").json()
        fid = up.json()["file_id"]
        found = [m for m in msgs if str(m.get("file_url", "")).startswith(f"/files/{fid}")]
        if found:
            url = found[0]["file_url"]
            check("подпись добавлена к ссылке в сообщении", "token=" in url,
                  url[:64] + "...")
            r = anon().get(f"{BASE}{url}", timeout=10)
            check("приватный файл отдаётся по подписи",
                  r.status_code == 200 and r.content == JPEG, f"{r.status_code}")
            r = anon().get(f"{BASE}{url.split('?')[0]}", timeout=10)
            check("та же ссылка без подписи закрыта", r.status_code == 403, f"{r.status_code}")
        else:
            check("ссылка на вложение вернулась в сообщении", False, "не найдена")

        # Документ: отдаётся только как attachment, а не инлайном. Иначе
        # загруженный под именем .pdf HTML исполнялся бы в браузере как
        # страница — то есть stored XSS.
        doc = owner.post(
            "/upload/file?scope=private",
            files={"file": ("invoice.pdf", io.BytesIO(PDF), "application/pdf")},
        )
        if doc.status_code == 200:
            owner.post(
                f"/tasks/{chat_task}/messages",
                json={"text": "смета", "file_url": doc.json()["url"],
                      "file_name": "invoice.pdf", "file_type": "application/pdf"},
            )
            msgs = owner.get(f"/tasks/{chat_task}/messages").json()
            doc_fid = doc.json()["file_id"]
            found = [m for m in msgs if str(m.get("file_url", "")).startswith(f"/files/{doc_fid}")]
            if found:
                r = anon().get(f"{BASE}{found[0]['file_url']}", timeout=10)
                disp = r.headers.get("content-disposition", "")
                check("документ отдаётся как attachment",
                      r.status_code == 200 and disp.startswith("attachment"),
                      f"{r.status_code} | {disp or 'нет Content-Disposition'}")
                check("документ отдаётся как octet-stream, не как pdf",
                      r.headers.get("content-type", "").startswith("application/octet-stream"),
                      r.headers.get("content-type", ""))
            else:
                check("документ вернулся в сообщении", False, "не найден")
        else:
            check("документ загружен", False, f"{doc.status_code} {doc.text[:120]}")
    else:
        print("  (нет сделки с исполнителем — проверка подписи пропущена)")

    # --- 4. Удаление -------------------------------------------------------
    r = other.delete(f"/files/{private_id}")
    check("чужой файл удалить нельзя", r.status_code == 403, f"{r.status_code} (ожидалось 403)")

    r = owner.delete(f"/files/{private_id}")
    check("свой файл удаляется", r.status_code == 200, f"{r.status_code}")

    r = anon().get(f"{BASE}{private_url}", timeout=10)
    check("удалённый файл больше не отдаётся", r.status_code == 404, f"{r.status_code}")

    print(f"\n=== ИТОГ: failed={_failed} ===")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
