"""
Регресс: точный адрес задания видят только участники сделки.

Запуск (из корня репозитория):
    python tests/security/check_task_address_privacy.py

Код возврата: 0 — адрес скрыт там, где должен, 1 — расхождение.

Почему этот файл существует
---------------------------
Заказчик пишет в поле «Адрес» улицу, дом, иногда квартиру — как правило,
свои. Лента GET /tasks/ и страница GET /tasks/{id} отдавали их любому
анонимному запросу вместе с точкой на карте до шестого знака. Измерено на
боевом сайте: `curl https://дело.online/tasks/` без входа возвращал адреса
и координаты всех открытых заданий.

Что проверяется
---------------
1. Лента (без фильтров, с фильтром, с пагинацией) — без адреса, координаты
   округлены до района, флаг address_hidden объясняет, что адрес есть;
2. попадание в кэш ленты отдаёт то же, что промах, — без адреса;
3. остальные поля ленты на месте (набор колонок не сузился случайно);
4. страница задания без входа и для постороннего исполнителя — без адреса;
5. заказчику, назначенному исполнителю и модератору — полный адрес и точка;
6. неверный, истёкший или refresh-токен — 401 (фронтенд продлит сессию
   и повторит запрос), а не тихий публичный вид;
7. задание без адреса и удалённое — address_hidden false, ничего не падает.
"""
import json
import os
import sys
from datetime import timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

MODERATOR = "moder@delo.ru"
isolate_env("check_task_address_privacy", ADMIN_EMAILS=MODERATOR)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.api.tasks import TASKS_LIST_CACHE_KEY  # noqa: E402
from app.core.cache import cache  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import create_access_token, create_refresh_token, hash_password  # noqa: E402
from app.models import Task, TaskCategory, TaskStatus, User, UserRole  # noqa: E402

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


# Кэш в памяти вместо Redis — тот же объект, что импортировал app/api/tasks.py
# (как в check_tasks_list_cache.py): путь попадания в кэш проверяется без сети.
store: dict = {}
cache.get = lambda key: store.get(key)
cache.set = lambda key, value, ttl_seconds=60: store.__setitem__(key, value) or True
cache.delete = lambda key: store.pop(key, None) is not None
cache.invalidate_pattern = lambda pattern: len([store.pop(k) for k in list(store) if k.startswith(pattern.rstrip("*"))])
cache.enabled = True

ADDRESS = "ул. Тверская, д. 7, кв. 12"
LAT, LON = 55.765432, 37.605678

Base.metadata.create_all(bind=engine)
db = SessionLocal()
users = {
    "customer": User(email="customer@mail.ru", role=UserRole.customer, name="Заказчик"),
    "executor": User(email="executor@mail.ru", role=UserRole.specialist, name="Исполнитель"),
    "stranger": User(email="stranger@mail.ru", role=UserRole.specialist, name="Посторонний"),
    "moderator": User(email=MODERATOR, role=UserRole.customer, name="Модератор"),
}
for u in users.values():
    u.hashed_password = hash_password("Password123")
db.add_all(users.values())
db.commit()
ids = {k: u.id for k, u in users.items()}

home = Task(title="ПОЧИНИТЬ КРАН", description="течёт", budget=2000, category=TaskCategory.repairs,
            customer_id=ids["customer"], executor_id=ids["executor"], status=TaskStatus.in_progress,
            city="Москва", address=ADDRESS, latitude=LAT, longitude=LON)
open_task = Task(title="СОБРАТЬ ШКАФ", description="кухня", budget=3000, category=TaskCategory.repairs,
                 customer_id=ids["customer"], status=TaskStatus.open,
                 city="Москва", address=ADDRESS, latitude=LAT, longitude=LON)
no_address = Task(title="ВЫГУЛЯТЬ СОБАКУ", description="утром", budget=500, category=TaskCategory.other,
                  customer_id=ids["customer"], status=TaskStatus.open,
                  city="Москва", address=None, latitude=55.751574, longitude=37.573856)
remote = Task(title="СВЕРСТАТЬ ЛЕНДИНГ", description="удалённо", budget=9000, category=TaskCategory.other,
              customer_id=ids["customer"], status=TaskStatus.open, is_remote=True)
db.add_all([home, open_task, no_address, remote])
db.commit()
task_ids = {"home": home.id, "open": open_task.id, "no_address": no_address.id, "remote": remote.id}
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def bearer(who: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[who])})}"}


def by_id(items: list, task_id: int) -> dict:
    return next((t for t in items if isinstance(t, dict) and t.get("id") == task_id), {})


def is_public(item: dict) -> bool:
    return (
        item.get("address") is None
        and item.get("latitude") == round(LAT, 2)
        and item.get("longitude") == round(LON, 2)
        and item.get("address_hidden") is True
    )


def is_exact(item: dict) -> bool:
    return (
        item.get("address") == ADDRESS
        and item.get("latitude") == LAT
        and item.get("longitude") == LON
        and item.get("address_hidden") is False
    )


def brief(item: dict) -> str:
    return json.dumps({k: item.get(k) for k in ("address", "latitude", "longitude", "address_hidden")},
                      ensure_ascii=False)


print("РЕГРЕСС: точный адрес задания — только участникам сделки")

print("\n1. Лента заданий")
miss = client.get("/tasks/")
check("GET /tasks/ отвечает 200", miss.status_code == 200, f"http={miss.status_code}")
item = by_id(miss.json() if miss.status_code == 200 else [], task_ids["open"])
check("в ленте нет адреса, точка округлена до района", is_public(item), brief(item))
check("город на месте", item.get("city") == "Москва", str(item.get("city")))
expected_fields = {c.name for c in Task.__table__.columns} | {"address_hidden"}
check("набор полей ленты прежний (все колонки + address_hidden)",
      set(item) == expected_fields, f"лишние={sorted(set(item) - expected_fields)} нет={sorted(expected_fields - set(item))}")
check("статус и категория — строки, как раньше", item.get("status") == "open" and item.get("category") == "repairs",
      f"status={item.get('status')} category={item.get('category')}")
check("с исполнителем в ленте тоже без адреса", is_public(by_id(miss.json(), task_ids["home"])),
      brief(by_id(miss.json(), task_ids["home"])))

print("\n2. Попадание в кэш")
check("лента записана в кэш", TASKS_LIST_CACHE_KEY in store, f"ключи: {sorted(store) or 'пусто'}")
check("в сыром значении кэша нет адреса", ADDRESS not in store.get(TASKS_LIST_CACHE_KEY, ""))
hit = client.get("/tasks/")
check("попадание совпадает с промахом", hit.status_code == 200 and hit.json() == miss.json())
check("старый ключ кэша (с адресами) не читается",
      TASKS_LIST_CACHE_KEY != "tasks:list:open:all")

print("\n3. Фильтры и пагинация")
filtered = client.get("/tasks/", params={"city": "Москва"})
check("с фильтром — без адреса", is_public(by_id(filtered.json(), task_ids["open"])),
      brief(by_id(filtered.json(), task_ids["open"])))
paged = client.get("/tasks/", params={"page": 1, "per_page": 10})
paged_items = paged.json().get("tasks", []) if paged.status_code == 200 else []
check("с пагинацией — без адреса", is_public(by_id(paged_items, task_ids["open"])),
      brief(by_id(paged_items, task_ids["open"])))
check("пагинация: метаданные на месте", paged.status_code == 200 and paged.json().get("total") == 4,
      f"http={paged.status_code} total={paged.json().get('total') if paged.status_code == 200 else '-'}")

print("\n4. Страница задания: посторонние")
anon = client.get(f"/tasks/{task_ids['home']}")
check("без входа — 200", anon.status_code == 200, f"http={anon.status_code}")
check("без входа — без адреса", is_public(anon.json()), brief(anon.json()))
stranger = client.get(f"/tasks/{task_ids['home']}", headers=bearer("stranger"))
check("посторонний исполнитель — без адреса", stranger.status_code == 200 and is_public(stranger.json()),
      f"http={stranger.status_code} {brief(stranger.json())}")

print("\n5. Страница задания: участники сделки")
for who in ("customer", "executor", "moderator"):
    resp = client.get(f"/tasks/{task_ids['home']}", headers=bearer(who))
    check(f"{who} видит адрес и точку", resp.status_code == 200 and is_exact(resp.json()),
          f"http={resp.status_code} {brief(resp.json())}")
open_for_customer = client.get(f"/tasks/{task_ids['open']}", headers=bearer("customer"))
check("заказчик видит адрес открытого задания", is_exact(open_for_customer.json()),
      brief(open_for_customer.json()))
open_for_executor = client.get(f"/tasks/{task_ids['open']}", headers=bearer("executor"))
check("исполнитель чужого задания (не назначен) — без адреса", is_public(open_for_executor.json()),
      brief(open_for_executor.json()))

print("\n6. Плохой токен — 401, а не публичный вид")
expired = create_access_token({"sub": str(ids["customer"])}, expires_delta=timedelta(minutes=-1))
refresh_token, _ = create_refresh_token(ids["customer"])
for label, token in (("истёкший", expired), ("refresh вместо access", refresh_token), ("мусорный", "not-a-jwt")):
    resp = client.get(f"/tasks/{task_ids['home']}", headers={"Authorization": f"Bearer {token}"})
    check(f"{label} токен — 401", resp.status_code == 401, f"http={resp.status_code}")
    check(f"{label} токен — адреса в ответе нет", ADDRESS not in resp.text)

print("\n7. Задания без адреса")
plain = client.get(f"/tasks/{task_ids['no_address']}").json()
check("без адреса: address_hidden false", plain.get("address_hidden") is False and plain.get("address") is None,
      json.dumps(plain.get("address_hidden")))
check("без адреса: точка округлена", plain.get("latitude") == 55.75 and plain.get("longitude") == 37.57,
      f"{plain.get('latitude')}, {plain.get('longitude')}")
rem = client.get(f"/tasks/{task_ids['remote']}").json()
check("удалённое: координат нет, ответ без ошибок",
      rem.get("latitude") is None and rem.get("longitude") is None and rem.get("address_hidden") is False,
      brief(rem))
listed_remote = by_id(client.get("/tasks/", params={"is_remote": True}).json(), task_ids["remote"])
check("удалённое в ленте: координат нет", listed_remote.get("latitude") is None and listed_remote.get("address_hidden") is False,
      brief(listed_remote))

print()
print(f"Проверок: {passed + failed}, провалено: {failed}")
sys.exit(1 if failed else 0)
