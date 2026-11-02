"""
Регресс: задания, отклики, товары и профиль проверяют ввод на сервере.

Запуск (из корня репозитория):
    python tests/security/check_input_limits.py

Код возврата: 0 — некорректный ввод отклоняется понятной ошибкой 422,
1 — расхождение.

Почему этот файл существует
---------------------------
POST /tasks/ принимал что угодно: задание с пустым названием и описанием,
с бюджетом −500 ₽ или сроком «вчера» публиковалось в общей ленте, а
бюджет 3 000 000 000 доходил до INSERT и отвечал 500 — колонки сумм
INTEGER, в PostgreSQL это не больше 2 147 483 647. То же с ценой и сроком
в отклике, с ценой и количеством товара; в профиле имя на 100 000 символов
попадало на публичную страницу специалиста.

Что проверяется
---------------
1. Задание: пустые и слишком длинные название/описание, бюджет меньше нуля
   и больше предела, прошедший и нечитаемый срок, координаты вне диапазона —
   422 с русским текстом; пробелы по краям обрезаются, бюджет 0 = «договорной».
2. Отклик: пустой текст, отрицательная и слишком большая цена, срок вне
   1–365 дней — 422; корректный отклик проходит.
3. Товар: цена и количество выше предела — 422 (раньше 500 на PostgreSQL).
4. Профиль: слишком длинные имя и телефон — 422; пустая строка по-прежнему
   очищает поле.
"""
import os
import re
import sys
from datetime import date, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

isolate_env("check_input_limits")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models import Task, User, UserRole  # noqa: E402

passed = 0
failed = 0
CYRILLIC = re.compile(r"[А-Яа-яЁё]")


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
customer = User(email="customer@mail.ru", role=UserRole.customer, name="Заказчик")
specialist = User(email="specialist@mail.ru", role=UserRole.specialist, name="Исполнитель")
for u in (customer, specialist):
    u.hashed_password = hash_password("Password123")
db.add_all([customer, specialist])
db.commit()
ids = {"customer": customer.id, "specialist": specialist.id}
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def bearer(who: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[who])})}"}


def messages(r) -> str:
    detail = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else None
    if isinstance(detail, list):
        return "; ".join(str(d.get("msg", "")) for d in detail)
    return str(detail)


def rejected(name: str, r, expect: str) -> None:
    """422 и русский текст, в котором есть ожидаемый фрагмент."""
    text = messages(r) if r.status_code == 422 else r.text[:120]
    check(name, r.status_code == 422 and expect in text and bool(CYRILLIC.search(text)),
          f"{r.status_code}: {text[:110]}")


TASK = {"title": "Собрать шкаф", "description": "Шкаф-купе, 2 м", "category": "repairs", "is_remote": True}
yesterday_but_one = (date.today() - timedelta(days=2)).isoformat()

print("1. Задание")
cases = [
    ("пустое название", {"title": "   "}, "Укажите название"),
    ("название из 2 символов", {"title": "ок"}, "минимум 3"),
    ("название длиннее 200", {"title": "я" * 201}, "не длиннее 200"),
    ("пустое описание", {"description": ""}, "Опишите задание"),
    ("описание длиннее 5000", {"description": "я" * 5001}, "не длиннее 5000"),
    ("бюджет меньше нуля", {"budget": -500}, "меньше нуля"),
    ("бюджет больше предела", {"budget": 10_000_001}, "не больше 10 000 000"),
    ("бюджет вне INTEGER (раньше 500)", {"budget": 3_000_000_000}, "не больше 10 000 000"),
    ("срок в прошлом", {"deadline": yesterday_but_one}, "в прошлом"),
    ("нечитаемый срок", {"deadline": "завтра"}, "ГГГГ-ММ-ДД"),
    ("широта вне диапазона", {"latitude": 999, "longitude": 37.6, "is_remote": False, "city": "Москва"}, "координаты"),
    ("адрес длиннее 200", {"address": "я" * 201, "is_remote": False, "city": "Москва"}, "не длиннее 200"),
]
for name, extra, expect in cases:
    rejected(name, client.post("/tasks/", json={**TASK, **extra}, headers=bearer("customer")), expect)

r = client.post("/tasks/", json={**TASK, "title": "  Собрать шкаф  ", "description": " Шкаф ", "budget": 0,
                                 "deadline": (date.today() + timedelta(days=7)).isoformat()},
                headers=bearer("customer"))
check("корректное задание создаётся", r.status_code == 200, f"{r.status_code}: {r.text[:100]}")
task_id = r.json().get("task_id") if r.status_code == 200 else None
db = SessionLocal()
stored = db.query(Task).filter(Task.id == task_id).first() if task_id else None
check("пробелы по краям обрезаны", bool(stored) and stored.title == "Собрать шкаф" and stored.description == "Шкаф",
      repr(stored.title) if stored else "нет задания")
check("бюджет 0 сохраняется как «договорной» (NULL)", bool(stored) and stored.budget is None,
      repr(stored.budget) if stored else "нет задания")
db.close()

print("2. Отклик")
if task_id:
    url = f"/tasks/{task_id}/responses"
    rejected("пустой текст отклика", client.post(url, json={"text": "  "}, headers=bearer("specialist")), "Напишите сообщение")
    rejected("цена меньше нуля", client.post(url, json={"text": "Сделаю", "proposed_price": -1}, headers=bearer("specialist")), "меньше нуля")
    rejected("цена вне INTEGER (раньше 500)", client.post(url, json={"text": "Сделаю", "proposed_price": 3_000_000_000}, headers=bearer("specialist")), "не больше 10 000 000")
    rejected("срок 366 дней", client.post(url, json={"text": "Сделаю", "estimated_days": 366}, headers=bearer("specialist")), "от 1 до 365")
    rejected("отрицательный срок", client.post(url, json={"text": "Сделаю", "estimated_days": -3}, headers=bearer("specialist")), "от 1 до 365")
    r = client.post(url, json={"text": "Сделаю за выходные", "proposed_price": 4500, "estimated_days": 2}, headers=bearer("specialist"))
    check("корректный отклик проходит", r.status_code == 200, f"{r.status_code}: {r.text[:100]}")

print("3. Товар")
PRODUCT = {"title": "Дрель Bosch", "description": "Почти новая, в коробке", "category": "other", "price": 3500, "stock": 1}
rejected("цена товара вне INTEGER (раньше 500)", client.post("/products/", json={**PRODUCT, "price": 3_000_000_000}, headers=bearer("specialist")), "не больше 10 000 000")
rejected("количество больше предела", client.post("/products/", json={**PRODUCT, "stock": 100_001}, headers=bearer("specialist")), "не больше 100 000")
r = client.post("/products/", json=PRODUCT, headers=bearer("specialist"))
check("корректный товар создаётся", r.status_code == 200, f"{r.status_code}: {r.text[:100]}")

print("4. Профиль")
rejected("имя длиннее 100", client.put("/users/me", json={"name": "я" * 101}, headers=bearer("customer")), "не длиннее 100")
rejected("телефон длиннее 30", client.put("/users/me", json={"phone": "1" * 31}, headers=bearer("customer")), "не длиннее 30")
r = client.put("/users/me", json={"name": "Анна", "bio": ""}, headers=bearer("customer"))
check("обычное сохранение профиля проходит", r.status_code == 200, f"{r.status_code}: {r.text[:100]}")
db = SessionLocal()
me = db.query(User).filter(User.id == ids["customer"]).first()
check("пустая строка очищает поле (bio)", me.name == "Анна" and (me.bio or "") == "", f"name={me.name!r} bio={me.bio!r}")
db.close()

print(f"\nИтого: {passed} OK, {failed} FAIL")
sys.exit(1 if failed else 0)
