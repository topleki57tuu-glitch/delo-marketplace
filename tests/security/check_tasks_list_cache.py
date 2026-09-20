"""
Регресс: попадание в кэш отдаёт те же данные, что и промах.

Запуск (из корня репозитория):
    python tests/security/check_tasks_list_cache.py

Код возврата: 0 — промах и попадание совпадают, 1 — попадание отдаёт мусор.

Почему этот файл существует
---------------------------
`GET /tasks/` без фильтров кэшируется на 60 секунд в Redis. В кэш уходил
результат `query.all()`, то есть ORM-объекты, а сериализация была такой:

    json.dumps(result, default=str)

`default=str` вызывается для всего, что JSON не умеет, — и превращает каждый
Task в строку `"<app.models.Task object at 0x...>"`. В результате первый запрос
(промах) отдавал нормальный список задач, а все последующие в течение минуты
(попадание) — список таких строк.

Почему это не замечалось: без Redis кэш выключен целиком, а на ноутбуке Redis
не запущен. В docker-compose.yml:50 и docker-compose.prod.yml:70 `REDIS_URL`
задан, то есть в этих контурах путь кэша живой. Плюс основной фронт ходит
в `/tasks/?page=N`, а с `page` запрос некешируемый — мимо дефекта.

Рядом в products.py тот же самый код работает: там результат заранее собран
словарями через `_serialize_product`, и `default=str` не срабатывает вовсе.
Совпадение имён и структуры и усыпило бдительность.

Проверки
--------
1. кэш действительно задействован (иначе проверять нечего);
2. промах, первое и второе попадание отдают одинаковое тело;
3. на попадании это список словарей с `title`, а не список строк;
4. в сыром значении кэша нет `<app.models.Task object at 0x`;
5. запрос с фильтром не читает кэш нефильтрованного списка;
6. набор герметичен: `isolate_env` перекрывает REDIS_URL джобы.

Redis для набора не нужен: подменяем только бэкенд кэша, объект `cache`
остаётся тем же, что импортировал `app/api/tasks.py`.
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1, живой REDIS_URL
# и боевой DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("check_tasks_list_cache")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.cache import cache  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.models import Task  # noqa: E402

CACHE_KEY = "tasks:list:open:all"

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


# --- Кэш в памяти вместо Redis -------------------------------------------------
# Объект `cache` — тот же самый, что импортировал app/api/tasks.py, поэтому
# подмены атрибутов достаточно. Набор остаётся самодостаточным: ни Redis,
# ни сети ему не нужно.
store: dict = {}


def _get(key):
    return store.get(key)


def _set(key, value, ttl_seconds=60):
    store[key] = value
    return True


def _delete(key):
    return store.pop(key, None) is not None


def _invalidate(pattern):
    prefix = pattern.rstrip("*")
    keys = [k for k in store if k.startswith(prefix)]
    for k in keys:
        store.pop(k, None)
    return len(keys)


cache.get = _get
cache.set = _set
cache.delete = _delete
cache.invalidate_pattern = _invalidate
cache.enabled = True

Base.metadata.create_all(bind=engine)

db = SessionLocal()
db.add_all([
    Task(title="ПОКРАСИТЬ ЗАБОР", description="два метра", customer_id=1, budget=5000),
    Task(title="СОБРАТЬ ШКАФ", description="кухня", customer_id=2, budget=3000),
])
db.commit()
db.close()

client = TestClient(main.app, raise_server_exceptions=False)

print("РЕГРЕСС: кэш списка задач отдаёт то же, что и без кэша")

print("\n1. Кэш задействован")
miss = client.get("/tasks/")
check("промах отвечает 200", miss.status_code == 200, f"http={miss.status_code}")
check("после промаха ключ записан", CACHE_KEY in store,
      f"ключи: {sorted(store) or 'пусто'}")

if CACHE_KEY not in store:
    print("\nКэш не заполнился — дальше проверять нечего.")
    print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
    sys.exit(1)

hit = client.get("/tasks/")
hit2 = client.get("/tasks/")

print("\n2. Промах и попадания совпадают")
check("тело промаха равно телу попадания", miss.text == hit.text,
      f"промах={miss.text[:80]!r}")
check("второе попадание тоже совпадает", miss.text == hit2.text)
check("попадание отвечает 200", hit.status_code == 200, f"http={hit.status_code}")

print("\n3. На попадании — данные, а не repr объектов")
try:
    payload = json.loads(hit.text)
except json.JSONDecodeError as exc:
    payload = None
    check("тело попадания — валидный JSON", False, str(exc))
else:
    check("тело попадания — валидный JSON", True)

if payload is not None:
    check("тело попадания — список", isinstance(payload, list), f"тип={type(payload).__name__}")
    check("элементы — словари, а не строки",
          bool(payload) and all(isinstance(x, dict) for x in payload),
          f"типы={sorted({type(x).__name__ for x in payload})}")
    check("в каждом элементе есть title",
          bool(payload) and all("title" in x for x in payload if isinstance(x, dict)))
    titles = [x.get("title") for x in payload if isinstance(x, dict)]
    check("заголовки задач на месте",
          titles == ["СОБРАТЬ ШКАФ", "ПОКРАСИТЬ ЗАБОР"], f"titles={titles}")

raw = store.get(CACHE_KEY, "")
check("в сыром кэше нет '<app.models.Task object at 0x'",
      "object at 0x" not in raw, f"raw={raw[:80]!r}")

print("\n4. Фильтрованный запрос не читает общий кэш")
filtered = client.get("/tasks/", params={"search": "ПОКРАСИТЬ"})
check("фильтр отвечает 200", filtered.status_code == 200, f"http={filtered.status_code}")
try:
    filtered_titles = [t.get("title") for t in filtered.json()]
except (json.JSONDecodeError, AttributeError, TypeError):
    filtered_titles = None
check("фильтр вернул только совпадение", filtered_titles == ["ПОКРАСИТЬ ЗАБОР"],
      f"titles={filtered_titles}")

print("\n5. Набор герметичен по Redis")
check("isolate_env перекрыл REDIS_URL джобы",
      os.environ.get("REDIS_URL") == "redis://127.0.0.1:1/0",
      f"REDIS_URL={os.environ.get('REDIS_URL')!r}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
