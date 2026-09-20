"""
Регресс: признак «онлайн» действительно вычисляется.

Запуск (из корня репозитория):
    python tests/security/check_online_status.py

Коды возврата: 0 — онлайн считается верно, 1 — признак мёртв или врёт.

Почему этот файл существует
---------------------------
Функция `user_online` была в ДВУХ копиях — `app/api/users.py` и
`app/api/responses.py`, — и обе возвращали False всегда, потому что каждая
оборачивала расчёт в `except Exception: return False`, а исключение возникало
на каждом вызове:

  * `users.py`: `datetime.now(timezone.utc) - user.last_seen` — aware минус
    naive, `TypeError: can't subtract offset-naive and offset-aware datetimes`;
  * `responses.py`: `datetime.fromisoformat(user.last_seen)` по объекту
    datetime — `TypeError: fromisoformat: argument must be str`.

Снаружи это выглядело так: `online` в `GET /users/me` и `GET /specialists/`
всегда false, `specialist_online` в списке откликов всегда false, бейдж
«Онлайн» на странице специалистов не отрисовывался никогда. При этом
`last_seen` обновляется middleware `track_last_seen` (main.py), а SQL-подсчёт
в админ-панели (`admin.py`) работал — то есть данные были верные, а признак
на них врал. Замер на стенде: `last_seen` отстоял на 91 секунду, админка
показывала 4 онлайн-пользователя, обе функции отвечали False.

Проверяем обе стороны: и саму функцию (включая типы, которые она обязана
принимать), и все четыре поверхности, где признак виден снаружи. Если кто-то
вернёт копию с `datetime.fromisoformat` или `timezone.utc`, проверки упадут.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
#
# ADMIN_EMAILS — здесь, а не через os.environ после импорта: is_admin() читает
# settings.ADMIN_EMAILS, а тот вычисляется один раз при импорте app.core.config.
# Присвоение после `import main` не дало бы ничего, и /admin/stats вернул бы 403.
isolate_env("check_online_status", ADMIN_EMAILS="admin@check.ru")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.presence import ONLINE_WINDOW_SECONDS, user_online  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import Response, Task, TaskStatus, User, UserRole  # noqa: E402

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


def check_online(name: str, value, expected: bool) -> None:
    """Проверяет user_online и превращает исключение в FAIL, а не в падение.

    Новая реализация исключения не глотает намеренно — именно глушение
    `except Exception: return False` и делало дефект невидимым. Но если регресс
    вернут, набор не должен умирать на первой же строке с трейсбеком: тогда
    непонятно, какие из поверхностей поехали. Показываем исключение текстом.
    """
    try:
        result = user_online(value)
    except Exception as exc:  # noqa: BLE001 — намеренно: показываем, а не прячем
        check(name, False, f"исключение {type(exc).__name__}: {exc}")
        return
    check(name, result is expected, f"вернулось {result!r}")


class Fake:
    """Минимальный носитель last_seen — функция не должна требовать ORM."""

    def __init__(self, last_seen):
        self.last_seen = last_seen


Base.metadata.create_all(bind=engine)
now = datetime.utcnow()

db = SessionLocal()
# Свежая активность — онлайн. Намеренно naive: именно так значение приходит
# из колонки Column(DateTime) без timezone=True.
fresh = User(email="fresh@check.ru", hashed_password="x", role=UserRole.specialist,
             last_seen=now - timedelta(seconds=5))
# Активность за пределами окна — не онлайн.
stale = User(email="stale@check.ru", hashed_password="x", role=UserRole.specialist,
             last_seen=now - timedelta(seconds=ONLINE_WINDOW_SECONDS + 60))
# Никогда не был активен.
never = User(email="never@check.ru", hashed_password="x", role=UserRole.specialist,
             last_seen=None)
customer = User(email="customer@check.ru", hashed_password="x", role=UserRole.customer,
                last_seen=now - timedelta(seconds=5))
admin = User(email="admin@check.ru", hashed_password="x", role=UserRole.customer,
             last_seen=now - timedelta(seconds=5))
db.add_all([fresh, stale, never, customer, admin])
db.commit()

# Задача с откликом от свежего специалиста — для проверки specialist_online.
task = Task(title="Задача", description="d", budget=10000,
            customer_id=customer.id, status=TaskStatus.open)
db.add(task)
db.commit()
db.add(Response(task_id=task.id, specialist_id=fresh.id, text="беру",
                proposed_price=9000))
db.add(Response(task_id=task.id, specialist_id=stale.id, text="тоже беру",
                proposed_price=9500))
db.commit()

ids = {u.email: u.id for u in (fresh, stale, never, customer, admin)}
task_id = task.id
db.close()

# raise_server_exceptions=False: иначе необработанное исключение в хендлере
# (а именно так выглядит возвращённый дефект — TypeError внутри user_online)
# поднимается наружу из TestClient, и набор умирает трейсбеком на разделе 2
# вместо того, чтобы показать, какие поверхности поехали. С этой настройкой
# ответ приходит как 500, и его ловит data().
client = TestClient(main.app, raise_server_exceptions=False)


def token(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[email])})}"}


def reset_presence() -> None:
    """Возвращает фикстурам их исходный last_seen.

    Нужно потому, что middleware `track_last_seen` (main.py) обновляет
    last_seen КАЖДОМУ, кто пришёл с токеном, — в том числе `stale` и `never`,
    как только их профиль запросят в разделе 2. Без сброса разделы 3–5
    увидели бы их онлайновыми, и проверки падали бы на верной реализации.

    Сброс держится до конца прогона: middleware пропускает обновление, если
    видел пользователя меньше 60 секунд назад (`_seen_cache`), а прогон
    занимает секунды.
    """
    db = SessionLocal()
    db.query(User).filter(User.id == ids["fresh@check.ru"]).update(
        {"last_seen": now - timedelta(seconds=5)})
    db.query(User).filter(User.id == ids["stale@check.ru"]).update(
        {"last_seen": now - timedelta(seconds=ONLINE_WINDOW_SECONDS + 60)})
    db.query(User).filter(User.id == ids["never@check.ru"]).update({"last_seen": None})
    db.commit()
    db.close()


print("=" * 68)
print("ПРОВЕРКА: признак «онлайн» (app/core/presence.py)")
print("=" * 68)

print("\n1. Сама функция — типы, которые обязана принимать")
check_online("свежий naive datetime -> онлайн", Fake(now - timedelta(seconds=5)), True)
check_online("старый naive datetime -> не онлайн",
             Fake(now - timedelta(seconds=ONLINE_WINDOW_SECONDS + 60)), False)
check_online("last_seen=None -> не онлайн", Fake(None), False)
check_online("пользователя нет -> не онлайн", None, False)
# Строка — след миграции b31957f1dbe9: до неё колонка хранила строку.
check_online("строка ISO -> онлайн", Fake((now - timedelta(seconds=5)).isoformat()), True)
# aware datetime: так писал middleware track_last_seen (datetime.now(timezone.utc)).
# Прежняя копия в users.py падала именно на этом.
check_online("aware datetime (UTC) -> онлайн",
             Fake(datetime.now(timezone.utc) - timedelta(seconds=5)), True)
check_online("aware datetime в не-UTC зоне -> онлайн",
             Fake(datetime.now(timezone(timedelta(hours=3)))), True)
# Мусор в строке не должен ронять запрос — но и не должен считаться онлайном.
check_online("неразбираемая строка -> не онлайн", Fake("не дата"), False)

def data(response, name: str):
    """Тело ответа как JSON или {} — с отдельным FAIL, если запрос не 200.

    Если регресс вернут, эндпоинт ответит 500 (TypeError внутри хендлера), и
    `response.json()` бросит JSONDecodeError. Тогда набор упал бы трейсбеком
    вместо списка сломанных поверхностей.
    """
    if response.status_code != 200:
        check(f"{name}: HTTP 200", False, f"пришло {response.status_code} {response.text[:80]}")
        return {}
    return response.json()


print("\n2. GET /users/me")
r = client.get("/users/me", headers=token("fresh@check.ru"))
me = data(r, "GET /users/me (свежий)")
check("свежий пользователь: online=true", me.get("online") is True,
      f"online={me.get('online')}, last_seen={me.get('last_seen')}")

r = client.get("/users/me", headers=token("stale@check.ru"))
check("давно не активен: online=false", data(r, "GET /users/me (неактивный)").get("online") is False)

r = client.get("/users/me", headers=token("never@check.ru"))
check("last_seen=NULL: online=false", data(r, "GET /users/me (без активности)").get("online") is False)

print("\n3. GET /specialists/ — бейдж «Онлайн» в каталоге")
reset_presence()
r = client.get("/specialists/")
items = {u["id"]: u for u in data(r, "GET /specialists/").get("items", [])}
check("свежий специалист в выдаче помечен онлайн",
      items.get(ids["fresh@check.ru"], {}).get("online") is True,
      f"online={items.get(ids['fresh@check.ru'], {}).get('online')}")
check("неактивный специалист не помечен онлайн",
      items.get(ids["stale@check.ru"], {}).get("online") is False)
check("никогда не активный не помечен онлайн",
      items.get(ids["never@check.ru"], {}).get("online") is False)

print("\n4. GET /tasks/{id}/responses — specialist_online в списке откликов")
reset_presence()
r = client.get(f"/tasks/{task_id}/responses", headers=token("customer@check.ru"))
rows = {row["specialist_id"]: row for row in data(r, "GET /tasks/{id}/responses")}
check("отклик свежего специалиста: specialist_online=true",
      rows.get(ids["fresh@check.ru"], {}).get("specialist_online") is True,
      f"specialist_online={rows.get(ids['fresh@check.ru'], {}).get('specialist_online')}")
check("отклик неактивного: specialist_online=false",
      rows.get(ids["stale@check.ru"], {}).get("specialist_online") is False)

print("\n5. GET /admin/stats — счётчик онлайна у модератора")
reset_presence()
r = client.get("/admin/stats", headers=token("admin@check.ru"))
stats_online = data(r, "GET /admin/stats").get("users", {}).get("online")
# Свежих трое: fresh, customer, admin. Считаем SQL-условием по той же границе,
# что и presence.py, поэтому число обязано совпасть, а не просто быть > 0.
expected = 3
check("счётчик онлайна совпадает с ожидаемым", stats_online == expected,
      f"online={stats_online}, ожидалось {expected}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
