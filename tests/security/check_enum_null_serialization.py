#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Регресс: пустая enum-колонка уезжает в JSON как null, а не как строка "None".

Запуск (из корня репозитория):
    python tests/security/check_enum_null_serialization.py

Код возврата: 0 — пустая колонка отдаётся как null, 1 — как строка "None".

Почему этот файл существует
---------------------------
По коду было разбросано 23 копии одного выражения:

    "category": t.category.value if hasattr(t.category, "value") else str(t.category)

Оно выглядит защитным — «значение бывает и enum, и строкой». Но у него есть
молчаливый побочный эффект: если колонка пуста, `hasattr(None, "value")` ложно,
и `str(None)` даёт СТРОКУ `"None"`. В JSON уезжает не `null`, а категория или
статус с названием None.

Чем это плохо на практике. Фронт сравнивает роль строго:

    role === 'customer'   (MyTasksPage.jsx:95,158,161)
    role === 'specialist' (tasksStore.js:70, ProfilePage.jsx:513)

Строка `"None"` не равна ни одному из них — как и `null`, — но, в отличие от
`null`, она ещё и truthy. То есть проверка вида `role ? ... : ...` уходит в
ветку «роль есть» и рисует пользователю слово None. В CSV-выгрузке кошелька
(users.py:378) `"None"` попадал в колонку «Тип» вместо пустой ячейки.

Почему дефект латентный: почти все эти колонки заполняют API-схемы и seed.
Но `nullable=False` не выставлен НИ У ОДНОЙ из них — в SQLAlchemy `Column()`
по умолчанию `nullable=True`, — а у двух колонок вообще нет `default`:

    Transaction.type  (models/__init__.py:101)
    Product.category  (models/__init__.py:379)

Значит NULL в них разрешён схемой и приезжает оттуда, где модель создают
напрямую: миграция, админский скрипт, ручная правка, импорт. Наборы группы 1
и 2 такого не делают, поэтому ни один из них дефект не ловил.

Что делает набор
----------------
Создаёт строки с валидными значениями, затем обнуляет enum-колонки ПРЯМЫМ
SQL — через ORM не выйдет: Python-side `default` подставляется ровно тогда,
когда атрибут не задан, поэтому `Task(category=None)` сохранит `other`, а не
NULL. После этого дёргает эндпоинты и требует `null`.

Отдельно проверяется, что в базе действительно NULL: иначе набор был бы
зелёным и на сломанном коде — например, если `default` всё-таки сработал
и колонка заполнена.
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
isolate_env("check_enum_null_serialization")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import (  # noqa: E402
    Order, Product, ProductCategory, ProductCondition, Task, TaskCategory,
    TaskStatus, Transaction, TransactionType, User, UserRole, WithdrawalRequest,
    WithdrawalStatus,
)

PASSWORD = "EnumNull_2026x!"
EMAIL = "enum-null@delo.test"
SELLER_EMAIL = "enum-null-seller@delo.test"

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

# --- Данные -------------------------------------------------------------------
# Пользователей создаём напрямую, а не через /register/: набору нужен вход,
# а не проверка политики пароля. Логинимся штатно — тем же /login, что и фронт.
db = SessionLocal()
buyer = User(
    email=EMAIL, hashed_password=hash_password(PASSWORD), name="Покупатель",
    role=UserRole.customer, balance=100_000,
)
seller = User(
    email=SELLER_EMAIL, hashed_password=hash_password(PASSWORD), name="Продавец",
    role=UserRole.specialist, balance=0,
)
db.add_all([buyer, seller])
db.commit()

# Две задачи: в первой покупатель — заказчик, во второй — исполнитель.
# Так проверяется не только `null` в полях, но и то, что контрагент
# подставлен верный: ровно на этом месте раньше стоял joinedload связи,
# которой у модели нет.
task = Task(
    title="ЗАДАЧА С ПУСТЫМИ ПОЛЯМИ", description="для регресса",
    customer_id=buyer.id, executor_id=seller.id, budget=1000,
    category=TaskCategory.other, status=TaskStatus.open,
)
task_as_executor = Task(
    title="ЗАДАЧА, ГДЕ Я ИСПОЛНИТЕЛЬ", description="для регресса",
    customer_id=seller.id, executor_id=buyer.id, budget=2000,
    category=TaskCategory.other, status=TaskStatus.open,
)
product = Product(
    seller_id=seller.id, title="ТОВАР С ПУСТЫМИ ПОЛЯМИ", description="для регресса",
    category=ProductCategory.other, condition=ProductCondition.new,
    price=1000, stock=1,
)
tx = Transaction(user_id=buyer.id, amount=500, type=TransactionType.deposit, fee=0)
wd = WithdrawalRequest(
    user_id=buyer.id, amount=100, method="card", requisites="encrypted-stub",
    status=WithdrawalStatus.pending,
)
order = Order(
    product_id=1, buyer_id=buyer.id, seller_id=seller.id, quantity=1,
    total_price=1000, delivery_method="pickup", platform_fee=50,
)
db.add_all([task, task_as_executor, product, tx, wd, order])
db.commit()

ids = {
    "task": task.id,
    "task_as_executor": task_as_executor.id,
    "product": product.id,
    "order": order.id,
    "transaction": tx.id,
    "withdrawal": wd.id,
    "user": buyer.id,
    "seller": seller.id,
}

# Обнуляем enum-колонки прямым SQL. Через ORM нельзя: `Task(category=None)`
# означает «атрибут не задан», и Python-side `default` подставит `other`.
NULLED = [
    ("tasks", "category = NULL, status = NULL", ids["task"]),
    ("products", "category = NULL, condition = NULL", ids["product"]),
    ("transactions", "type = NULL", ids["transaction"]),
    ("withdrawal_requests", "status = NULL", ids["withdrawal"]),
    ("orders", "status = NULL", ids["order"]),
    ("users", "role = NULL", ids["user"]),
]
for table, assignments, row_id in NULLED:
    db.execute(text(f"UPDATE {table} SET {assignments} WHERE id = :i"), {"i": row_id})
db.commit()
db.close()

# --- Предохранитель: в базе действительно NULL ---------------------------------
# Без этой проверки набор был бы зелёным и на сломанном коде: если бы `default`
# всё-таки заполнил колонку, сериализатор вернул бы нормальное значение.
print("0. В базе действительно NULL (иначе проверки ниже пустые)")
db = SessionLocal()
raw_nulls = {
    "tasks.category": db.execute(
        text("SELECT category FROM tasks WHERE id = :i"), {"i": ids["task"]}
    ).scalar(),
    "tasks.status": db.execute(
        text("SELECT status FROM tasks WHERE id = :i"), {"i": ids["task"]}
    ).scalar(),
    "products.category": db.execute(
        text("SELECT category FROM products WHERE id = :i"), {"i": ids["product"]}
    ).scalar(),
    "transactions.type": db.execute(
        text("SELECT type FROM transactions WHERE id = :i"), {"i": ids["transaction"]}
    ).scalar(),
    "users.role": db.execute(
        text("SELECT role FROM users WHERE id = :i"), {"i": ids["user"]}
    ).scalar(),
}
db.close()
for column, value in raw_nulls.items():
    check(f"{column} в базе пуст", value is None, f"значение={value!r}")

if any(v is not None for v in raw_nulls.values()):
    print("\nКолонки не обнулились — проверять сериализацию бессмысленно.")
    print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
    sys.exit(1)

client = TestClient(main.app, raise_server_exceptions=False)

print("\nВход")
login = client.post("/login", data={"username": EMAIL, "password": PASSWORD})
if login.status_code != 200:
    print(f"  вход не удался: {login.status_code} {login.text[:200]}")
    print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
    sys.exit(1)
auth = {"Authorization": f"Bearer {login.json()['access_token']}"}
check("вход выполнен", login.status_code == 200)
check("в теле входа role = null, а не строка 'None'",
      login.json().get("role") is None,
      f"role={login.json().get('role')!r}")


def assert_null_field(label: str, response, field: str) -> None:
    """200 + поле равно null + в сыром теле нет строки "None"."""
    if response.status_code != 200:
        check(f"{label}: отвечает 200", False,
              f"http={response.status_code} {response.text[:120]}")
        return
    check(f"{label}: отвечает 200", True)
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        check(f"{label}: валидный JSON", False, str(exc))
        return
    value = payload.get(field) if isinstance(payload, dict) else None
    check(f"{label}: {field} = null", value is None, f"значение={value!r}")
    check(f"{label}: {field} не строка 'None'", value != "None", f"значение={value!r}")
    check(f"{label}: в сыром теле нет \"None\"",
          '"None"' not in response.text,
          f"тело={response.text[:120]}")


print("\n1. GET /tasks/{id} — карточка заказа (без авторизации)")
assert_null_field("заказ", client.get(f"/tasks/{ids['task']}"), "category")
assert_null_field("заказ", client.get(f"/tasks/{ids['task']}"), "status")

print("\n2. GET /tasks/my — список своих заказов (сериализатор result.append)")
my_tasks = client.get("/tasks/my", params={"role": "customer"}, headers=auth)
if my_tasks.status_code == 200:
    check("список своих заказов отвечает 200", True)
    rows = [r for r in my_tasks.json() if r.get("id") == ids["task"]]
    check("заказ с пустыми полями попал в список", bool(rows),
          f"id={ids['task']} в {len(my_tasks.json())} строках")
    if rows:
        check("category в списке = null", rows[0].get("category") is None,
              f"значение={rows[0].get('category')!r}")
        check("status в списке = null", rows[0].get("status") is None,
              f"значение={rows[0].get('status')!r}")
        # Ради этого и стоял joinedload: заказчик должен видеть исполнителя.
        check("контрагент — исполнитель заказа",
              rows[0].get("counterparty_id") == ids["seller"],
              f"counterparty_id={rows[0].get('counterparty_id')!r}, "
              f"ожидался {ids['seller']}")
        check("имя контрагента подставлено",
              rows[0].get("counterparty_name") == "Продавец",
              f"counterparty_name={rows[0].get('counterparty_name')!r}")
    check("в сыром теле списка нет \"None\"", '"None"' not in my_tasks.text,
          f"тело={my_tasks.text[:120]}")
else:
    check("список своих заказов отвечает 200", False,
          f"http={my_tasks.status_code} {my_tasks.text[:120]}")

print("\n2б. GET /tasks/my?role=executor — обратная сторона")
as_executor = client.get("/tasks/my", params={"role": "executor"}, headers=auth)
if as_executor.status_code == 200:
    check("список заказов, где я исполнитель, отвечает 200", True)
    mine = [r for r in as_executor.json() if r.get("id") == ids["task_as_executor"]]
    check("заказ, где я исполнитель, попал в список", bool(mine),
          f"id={ids['task_as_executor']} в {len(as_executor.json())} строках")
    if mine:
        check("контрагент — заказчик заказа",
              mine[0].get("counterparty_id") == ids["seller"],
              f"counterparty_id={mine[0].get('counterparty_id')!r}")
    # Заказ, где я заказчик, в этот список попасть не должен.
    check("чужой заказ в список исполнителя не попал",
          all(r.get("id") != ids["task"] for r in as_executor.json()),
          f"ids={[r.get('id') for r in as_executor.json()]}")
else:
    check("список заказов, где я исполнитель, отвечает 200", False,
          f"http={as_executor.status_code} {as_executor.text[:120]}")

print("\n3. GET /products/{id} — карточка товара (без авторизации)")
assert_null_field("товар", client.get(f"/products/{ids['product']}"), "category")
assert_null_field("товар", client.get(f"/products/{ids['product']}"), "condition")

print("\n4. GET /users/me — профиль")
assert_null_field("профиль", client.get("/users/me", headers=auth), "role")

print("\n5. GET /wallet/transactions — история кошелька")
txs = client.get("/wallet/transactions", headers=auth)
if txs.status_code == 200:
    check("история кошелька отвечает 200", True)
    check("история — список", isinstance(txs.json(), list),
          f"тип={type(txs.json()).__name__}")
    types = [r.get("type") for r in txs.json() if isinstance(r, dict)]
    check("тип транзакции = null, а не строка 'None'",
          all(t is None for t in types), f"types={types}")
    check("в сыром теле истории нет \"None\"", '"None"' not in txs.text,
          f"тело={txs.text[:120]}")
else:
    check("история кошелька отвечает 200", False,
          f"http={txs.status_code} {txs.text[:120]}")

print("\n6. GET /wallet/withdrawals — заявки на вывод")
wds = client.get("/wallet/withdrawals", headers=auth)
if wds.status_code == 200:
    check("заявки на вывод отвечают 200", True)
    statuses = [r.get("status") for r in wds.json() if isinstance(r, dict)]
    check("статус заявки = null, а не строка 'None'",
          all(s is None for s in statuses), f"statuses={statuses}")
    check("в сыром теле заявок нет \"None\"", '"None"' not in wds.text,
          f"тело={wds.text[:120]}")
else:
    check("заявки на вывод отвечают 200", False,
          f"http={wds.status_code} {wds.text[:120]}")

print("\n7. GET /products/orders — список заказов товаров")
orders = client.get("/products/orders", headers=auth)
if orders.status_code == 200:
    check("заказы товаров отвечают 200", True)
    purchases = orders.json().get("purchases", []) if isinstance(orders.json(), dict) else []
    mine = [o for o in purchases if o.get("id") == ids["order"]]
    check("заказ с пустым статусом попал в список", bool(mine),
          f"id={ids['order']} среди {len(purchases)} покупок")
    if mine:
        check("статус заказа = null", mine[0].get("status") is None,
              f"значение={mine[0].get('status')!r}")
    check("в сыром теле заказов нет \"None\"", '"None"' not in orders.text,
          f"тело={orders.text[:120]}")
else:
    check("заказы товаров отвечают 200", False,
          f"http={orders.status_code} {orders.text[:120]}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
