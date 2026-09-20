#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Регресс: чужое приватное вложение нельзя получить, назвав его id.

Запуск (из корня репозитория):
    python tests/security/check_private_attachment_access.py

Код возврата: 0 — вложение защищено, 1 — утекает.

Суть дефекта
------------
`POST /tasks/{id}/messages` принимал `file_url` ОТ КЛИЕНТА и сохранял как
есть. Схема `MessageCreate` проверяла только форму строки (`/files/<id>` или
http(s)) — владение не проверялось. При отдаче сообщений ссылка подписывалась
функцией `file_url_with_token`, а та подписывает ЛЮБОЙ `/files/<id>`:

    def sign_file_token(file_id):          # app/core/security.py:233
        return "f1" + hmac(SECRET_KEY, f"file:{file_id}")

Подпись — чистая функция от id файла: ни пользователя, ни сделки, ни срока
в ней нет. Значит участник любой сделки мог назвать id чужого приватного
файла, получить на него валидную подпись и прочитать файл, хотя доступ
к самой переписке, где файл лежит, ему закрыт.

Почему это не пустая теория: id — последовательное целое, а в приватных
вложениях лежат не только картинки, но и документы (`/upload/file`): сметы,
чеки, сканы. Комментарий в chat.py считал, что раз подпись выдаёт сервер, то
получить её может только участник сделки, — но файл к сделке не привязан
вообще, привязан только id, который назвал отправитель.

Что проверяется теперь
----------------------
1. при отправке прикрепить чужой файл нельзя — 403;
2. прикрепить свой файл по-прежнему можно, и он открывается по подписи;
3. строка, попавшая в базу ДО правки, не подписывается: подписи в ответе
   нет, а сам файл остаётся закрытым. Это второй рубеж — иначе уже
   существующие в базе сообщения продолжали бы отдавать чужой файл;
4. доступ к чужой переписке и к файлу без подписи закрыт (как и раньше).
"""
import io
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

isolate_env("check_private_attachment_access")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Message, Task, TaskCategory, TaskStatus, User, UserRole  # noqa: E402

PASSWORD = "Attach_2026x!"
VICTIM = "attach-victim@delo.test"
ATTACKER = "attach-attacker@delo.test"

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

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


Base.metadata.create_all(bind=engine)

db = SessionLocal()
victim = User(
    email=VICTIM, hashed_password=hash_password(PASSWORD), name="Жертва",
    role=UserRole.customer, balance=0,
)
attacker = User(
    email=ATTACKER, hashed_password=hash_password(PASSWORD), name="Атакующий",
    role=UserRole.customer, balance=0,
)
db.add_all([victim, attacker])
db.commit()

# Переписка жертвы, куда атакующий не входит: он не заказчик и не исполнитель.
victim_task = Task(
    title="ЛИЧНАЯ ПЕРЕПИСКА ЖЕРТВЫ", description="только для жертвы",
    customer_id=victim.id, executor_id=None,
    category=TaskCategory.other, status=TaskStatus.open,
)
# Переписка атакующего — здесь он полноправный участник.
attacker_task = Task(
    title="ПЕРЕПИСКА АТАКУЮЩЕГО", description="его собственная",
    customer_id=attacker.id, executor_id=None,
    category=TaskCategory.other, status=TaskStatus.open,
)
db.add_all([victim_task, attacker_task])
db.commit()
victim_task_id, attacker_task_id = victim_task.id, attacker_task.id
attacker_id = attacker.id
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def login(email: str) -> dict:
    r = client.post("/login", data={"username": email, "password": PASSWORD})
    if r.status_code != 200:
        print(f"  вход {email} не удался: {r.status_code} {r.text[:200]}")
        sys.exit(2)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


victim_auth = login(VICTIM)
attacker_auth = login(ATTACKER)


def upload_private(auth: dict, name: str = "secret.jpg"):
    return client.post(
        "/upload/image?scope=private",
        headers=auth,
        files={"file": (name, io.BytesIO(JPEG), "image/jpeg")},
    )


def attachment_url(auth: dict, task_id: int, file_id: int):
    """Ссылка на вложение из списка сообщений сделки."""
    r = client.get(f"/tasks/{task_id}/messages", headers=auth)
    if r.status_code != 200:
        return None, r
    for m in r.json():
        if str(m.get("file_url", "")).startswith(f"/files/{file_id}"):
            return m["file_url"], r
    return None, r


print("РЕГРЕСС: чужое приватное вложение по id не отдаётся")

print("\n1. Жертва вкладывает приватный файл в свою переписку")
up = upload_private(victim_auth)
if up.status_code != 200:
    print(f"  загрузка не удалась: {up.status_code} {up.text[:200]}")
    sys.exit(2)
secret_id = up.json()["file_id"]
check("приватный файл загружен", up.status_code == 200, f"file_id={secret_id}")

posted = client.post(
    f"/tasks/{victim_task_id}/messages",
    headers=victim_auth,
    json={"text": "скан документа", "file_url": f"/files/{secret_id}",
          "file_name": "secret.jpg", "file_type": "image/jpeg"},
)
check("жертва отправила вложение в свою переписку", posted.status_code == 200,
      f"http={posted.status_code}")

print("\n2. Атакующий доступа к переписке жертвы не имеет")
r = client.get(f"/tasks/{victim_task_id}/messages", headers=attacker_auth)
check("чужая переписка закрыта", r.status_code == 403, f"http={r.status_code}")

r = client.get(f"/files/{secret_id}")
check("приватный файл без подписи закрыт", r.status_code == 403, f"http={r.status_code}")

print("\n3. Атакующий пробует прикрепить чужой файл в СВОЕЙ переписке")
forged = client.post(
    f"/tasks/{attacker_task_id}/messages",
    headers=attacker_auth,
    json={"text": "смотрите что нашёл", "file_url": f"/files/{secret_id}",
          "file_name": "secret.jpg", "file_type": "image/jpeg"},
)
check("чужой файл прикрепить нельзя", forged.status_code == 403,
      f"http={forged.status_code} (ожидалось 403) {forged.text[:100]}")

url, _ = attachment_url(attacker_auth, attacker_task_id, secret_id)
check("ссылки на чужой файл в переписке атакующего нет", url is None,
      f"file_url={str(url)[:70]!r}")

print("\n4. Строка, попавшая в базу ДО правки, не подписывается")
# Второй рубеж: в боевых базах уже могут лежать такие сообщения. Пишем строку
# напрямую, минуя API, — иначе проверить нечего: POST теперь отклоняется.
db = SessionLocal()
db.add(Message(
    task_id=attacker_task_id, sender_id=attacker_id, text="унаследованное",
    file_url=f"/files/{secret_id}", file_name="secret.jpg", file_type="image/jpeg",
))
db.commit()
db.close()

legacy_url, resp = attachment_url(attacker_auth, attacker_task_id, secret_id)
check("унаследованное сообщение вернулось", legacy_url is not None,
      f"http={getattr(resp, 'status_code', '?')}")
check("подписи в нём нет", bool(legacy_url) and "token=" not in str(legacy_url),
      f"file_url={str(legacy_url)[:70]!r}")
if legacy_url:
    r = client.get(str(legacy_url))
    leaked = r.status_code == 200 and r.content == JPEG
    check("чужой файл по такой ссылке не отдаётся", not leaked,
          f"http={r.status_code}, {len(r.content)} байт"
          + (" — ФАЙЛ УТЁК" if leaked else ""))

print("\n5. Законный сценарий не сломан")
own_url, _ = attachment_url(victim_auth, victim_task_id, secret_id)
check("автор видит свою ссылку с подписью",
      bool(own_url) and "token=" in str(own_url), f"file_url={str(own_url)[:70]!r}")
if own_url:
    r = client.get(str(own_url))
    check("автор открывает своё вложение по подписи",
          r.status_code == 200 and r.content == JPEG,
          f"http={r.status_code}, {len(r.content)} байт")

# Атакующий прикрепляет СВОЙ файл — это должно работать как раньше.
own = upload_private(attacker_auth, "mine.jpg")
check("атакующий загрузил свой файл", own.status_code == 200, f"http={own.status_code}")
if own.status_code == 200:
    own_id = own.json()["file_id"]
    ok = client.post(
        f"/tasks/{attacker_task_id}/messages",
        headers=attacker_auth,
        json={"text": "мой файл", "file_url": f"/files/{own_id}",
              "file_name": "mine.jpg", "file_type": "image/jpeg"},
    )
    check("свой файл прикрепить можно", ok.status_code == 200, f"http={ok.status_code}")
    mine_url, _ = attachment_url(attacker_auth, attacker_task_id, own_id)
    check("свой файл отдаётся по подписи",
          bool(mine_url) and "token=" in str(mine_url), f"file_url={str(mine_url)[:70]!r}")
    if mine_url:
        r = client.get(str(mine_url))
        check("свой файл открывается",
              r.status_code == 200 and r.content == JPEG, f"http={r.status_code}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
