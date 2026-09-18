"""
Регресс: скан документа в заявке на верификацию.

Запуск (из корня репозитория):
    python tests/security/repro_verification_document_access.py

Код возврата: 0 — защита на месте, 1 — дефект вернулся.

Почему этот файл существует
---------------------------
`VerificationSubmitRequest.file_url` не проверялось вообще — ни длины, ни
формата, ни прав на файл. Это ровно тот же дефект, что уже чинили в
`MessageCreate.file_url`, но здесь он хуже по двум причинам:

1. Значение уходит модератору (`GET /verification/admin/list`). В поле можно
   было положить `javascript:` или `data:text/html` — заготовку под stored XSS
   на самом привилегированном экране. Сработала бы она в тот момент, когда скан
   начнут показывать: то есть защита держалась на «мы это поле пока не
   рисуем», а не на коде.
2. Через поле в БД попадало что угодно, включая base64 целиком — тем же
   способом, каким в чате раздувало строку `messages.file_url`.

Отдельно проверяется то, чего не было совсем: ссылка на **чужой** файл
принималась, и модератор сверял бы номер документа с чужим сканом. А скан,
загруженный публичным, оставался перечислимым по `/files/<id>` — фото паспорта
лежало в открытом доступе.

Что защищается сейчас:
  1. base64, `javascript:` и внешние адреса в поле отбиваются 422;
  2. приложить можно только свой файл (чужой → 403, несуществующий → 400);
  3. принятый скан становится приватным — анонимно он больше не читается;
  4. владелец и модератор получают ссылку с подписью и она работает;
  5. заявка без скана по-прежнему принимается — интерфейс его не отправляет,
     и ломать этот путь нельзя;
  6. заказчик (не специалист) заявку подать не может, как и раньше.
"""
import base64
import io
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Модератор определяется по ADMIN_EMAILS — задаём свой адрес, чтобы набор не
# зависел от демо-данных и не выдавал права никому лишнему.
isolate_env("repro_verification_doc", ADMIN_EMAILS="moderator@check.ru")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import StoredFile, User, UserRole  # noqa: E402

# Минимальный валидный JPEG — бэкенд опознаёт формат по magic bytes.
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")

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
specialist = User(email="spec@check.ru", hashed_password="x", role=UserRole.specialist)
other = User(email="other@check.ru", hashed_password="x", role=UserRole.specialist)
second = User(email="second@check.ru", hashed_password="x", role=UserRole.specialist)
customer = User(email="customer@check.ru", hashed_password="x", role=UserRole.customer)
moderator = User(email="moderator@check.ru", hashed_password="x", role=UserRole.customer)
db.add_all([specialist, other, second, customer, moderator])
db.commit()
ids = {u.email: u.id for u in (specialist, other, second, customer, moderator)}
db.close()

client = TestClient(main.app)


def auth(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[email])})}"}


def upload(email: str, scope: str = "public", name: str = "scan.jpg"):
    return client.post(
        f"/upload/image?scope={scope}",
        headers=auth(email),
        files={"file": (name, io.BytesIO(JPEG), "image/jpeg")},
    )


def submit(email: str, **fields):
    payload = {"full_name": "Иванов Иван Иванович", "document_type": "passport"}
    payload.update(fields)
    return client.post("/verification/submit", headers=auth(email), json=payload)


def anon_get(path: str):
    return client.get(path)


print("=" * 68)
print("ПРОВЕРКА: скан документа в заявке на верификацию")
print("=" * 68)

# --- Подготовка: два файла, свой и чужой ------------------------------------
own = upload("spec@check.ru", scope="public")
foreign = upload("other@check.ru", scope="public")
if own.status_code != 200 or foreign.status_code != 200:
    print(f"  не удалось загрузить файлы: {own.status_code} {foreign.status_code}")
    sys.exit(2)

own_url = own.json()["url"]
own_id = own.json()["file_id"]
foreign_url = foreign.json()["url"]

print("\n1. Содержимое поля file_url проверяется")
check("base64 в поле отбивается",
      submit("spec@check.ru",
             file_url="data:image/jpeg;base64," + base64.b64encode(JPEG * 40).decode()
             ).status_code == 422,
      "422")
check("javascript: отбивается",
      submit("spec@check.ru", file_url="javascript:alert(document.cookie)").status_code == 422,
      "422")
check("внешний адрес отбивается (документ должен лежать у нас)",
      submit("spec@check.ru", file_url="https://evil.example/scan.jpg").status_code == 422,
      "422")
check("слишком длинная ссылка отбивается",
      submit("spec@check.ru", file_url="/files/" + "9" * 600).status_code == 422,
      "422")

print("\n2. Ссылаться можно только на свой файл")
r = submit("spec@check.ru", file_url=foreign_url)
check("чужой файл в заявку не принимается", r.status_code == 403,
      f"{r.status_code} (ожидалось 403)")

r = submit("spec@check.ru", file_url="/files/999999")
check("несуществующий файл отбивается", r.status_code == 400,
      f"{r.status_code} (ожидалось 400)")

print("\n3. Свой файл принимается и закрывается от посторонних")
check("до заявки файл был публичным",
      anon_get(own_url).status_code == 200,
      f"{anon_get(own_url).status_code}")

r = submit("spec@check.ru", file_url=own_url)
check("заявка со своим файлом принята", r.status_code == 200,
      f"{r.status_code} {r.text[:120]}")
if r.status_code != 200:
    print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
    sys.exit(1)

signed_url = r.json().get("file_url") or ""
check("в ответе пришла подписанная ссылка", "token=" in signed_url, signed_url[:64] + "...")

anon_plain = anon_get(own_url)
check("анонимно скан больше не читается", anon_plain.status_code == 403,
      f"{anon_plain.status_code} (ожидалось 403)")

r = anon_get(signed_url)
check("по подписи скан отдаётся", r.status_code == 200 and r.content == JPEG,
      f"{r.status_code}")

db = SessionLocal()
stored = db.query(StoredFile).filter(StoredFile.id == own_id).first()
check("файл помечен приватным в БД", stored is not None and stored.is_private is True,
      f"is_private={stored.is_private if stored else 'нет записи'}")
db.close()

print("\n4. Модератор видит скан, посторонний — нет")
r = client.get("/verification/admin/list", headers=auth("moderator@check.ru"))
check("модератор получает список заявок", r.status_code == 200, f"{r.status_code}")
items = r.json() if r.status_code == 200 else []
mine = [i for i in items if i.get("user_id") == ids["spec@check.ru"]]
if mine:
    admin_url = mine[0].get("file_url") or ""
    check("модератору пришла подписанная ссылка", "token=" in admin_url,
          admin_url[:64] + "...")
    r = anon_get(admin_url)
    check("по ссылке модератора скан открывается",
          r.status_code == 200 and r.content == JPEG, f"{r.status_code}")
else:
    check("заявка видна в списке модератора", False, "не найдена")

r = client.get("/verification/admin/list", headers=auth("spec@check.ru"))
check("специалист список заявок не видит", r.status_code == 403, f"{r.status_code}")

print("\n5. Ответы верификации вообще сериализуются")
# Здесь ловится отдельный, не связанный с файлами дефект: схема объявляла
# `created_at` и `resolved_at` как `str`, а `_request_out` возвращал datetime.
# FastAPI падал на валидации ответа — то есть подать заявку было нельзя вовсе
# (500), и это не замечалось, потому что `response_model` во всём API стоит
# ровно на этих двух эндпоинтах, а единственный тест бил по ним через CSRF и
# получал 403 до обработчика.
r = client.get("/verification/status", headers=auth("spec@check.ru"))
check("GET /verification/status отвечает 200", r.status_code == 200,
      f"{r.status_code} {r.text[:160]}")
body = r.json() if r.status_code == 200 else {}
req = body.get("request") or {}
check("created_at приходит строкой", isinstance(req.get("created_at"), str),
      f"{type(req.get('created_at')).__name__} = {req.get('created_at')!r}")

# Решение модератора проставляет resolved_at — вторая половина того же дефекта.
r = client.post(f"/verification/admin/{req.get('id')}/review",
                headers=auth("moderator@check.ru"), json={"action": "approve"})
check("модератор может одобрить заявку", r.status_code == 200,
      f"{r.status_code} {r.text[:160]}")

r = client.get("/verification/status", headers=auth("spec@check.ru"))
check("статус читается после решения модератора", r.status_code == 200,
      f"{r.status_code} {r.text[:160]}")
resolved = (r.json().get("request") or {}).get("resolved_at") if r.status_code == 200 else None
check("resolved_at приходит строкой", isinstance(resolved, str),
      f"{type(resolved).__name__} = {resolved!r}")

db = SessionLocal()
owner = db.query(User).filter(User.id == ids["spec@check.ru"]).first()
check("после одобрения пользователь верифицирован", owner.verified is True,
      f"verified={owner.verified}")
db.close()

print("\n6. Прежние пути не сломаны")
r = submit("second@check.ru")  # интерфейс скан не отправляет — путь без file_url
check("заявка без скана по-прежнему принимается", r.status_code == 200,
      f"{r.status_code} {r.text[:120]}")

r = submit("customer@check.ru", file_url=own_url)
check("заказчик заявку подать не может", r.status_code == 403, f"{r.status_code}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
