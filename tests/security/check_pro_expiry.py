"""
Регресс: права считаются по сроку подписки, а не по флагу `is_pro`.

Запуск (из корня репозитория):
    python tests/security/check_pro_expiry.py

Код возврата: 0 — права считаются по сроку, 1 — истёкшая подписка снова
даёт права.

Почему этот файл существует
---------------------------
`is_pro` — это намерение («подписка оформлялась»), а не состояние. Снять флаг
должна была celery-задача `check_expired_pro_subscriptions`, но `celery` нет в
`requirements.txt` и ни один контур развёртывания не поднимает воркер. Пока
права читались из колонки, подписка продолжала действовать бессрочно: 0%
комиссии и безлимит откликов навсегда.

Проверка идёт по четырём поверхностям, где это видно снаружи:
1. отклики при исчерпанных кредитах (`responses.py`);
2. комиссия при завершении сделки (`tasks.py`);
3. метка PRO в выдаче профиля (`users.py`);
4. патология «флаг есть, срока нет» — такая подписка не действует.

Если кто-то вернёт чтение `is_pro` на место `is_pro_active`, эти проверки
упадут: отклик пройдёт с 200, комиссия станет 0%.
"""
import os
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

os.environ.setdefault("ENV", "development")
os.environ.setdefault("SECRET_KEY", "pro-expiry-check-not-for-production")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
DB = r"C:/tmp/check_pro_expiry.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB}")

if os.path.exists(DB):
    os.remove(DB)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import Task, TaskStatus, User, UserRole  # noqa: E402

BUDGET = 10000
FEE_PERCENT = 5

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
now = datetime.utcnow()

db = SessionLocal()
expired = User(email="expired@check.ru", hashed_password="x", role=UserRole.specialist,
               is_pro=True, pro_until=now - timedelta(days=1), response_credits=0, balance=0)
active = User(email="active@check.ru", hashed_password="x", role=UserRole.specialist,
              is_pro=True, pro_until=now + timedelta(days=30), response_credits=0, balance=0)
plain = User(email="plain@check.ru", hashed_password="x", role=UserRole.specialist,
             is_pro=False, pro_until=None, response_credits=10, balance=0)
broken = User(email="broken@check.ru", hashed_password="x", role=UserRole.specialist,
              is_pro=True, pro_until=None, response_credits=0, balance=0)
customer = User(email="customer@check.ru", hashed_password="x", role=UserRole.customer, balance=0)
db.add_all([expired, active, plain, broken, customer])
db.commit()

open_task = Task(title="Открытая задача", description="d", budget=BUDGET,
                 customer_id=customer.id, status=TaskStatus.open)
db.add(open_task)
db.commit()

ids = {u.email: u.id for u in (expired, active, plain, broken, customer)}
open_task_id = open_task.id
db.close()

client = TestClient(main.app)


def token(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[email])})}"}


def complete_for(email: str) -> int:
    """Завершить сделку с исполнителем email, вернуть удержанную комиссию."""
    db = SessionLocal()
    task = Task(title="Сделка", description="d", budget=BUDGET,
                customer_id=ids["customer@check.ru"], executor_id=ids[email],
                status=TaskStatus.in_progress)
    db.add(task)
    db.commit()
    task_id = task.id
    before = db.query(User).filter(User.id == ids[email]).first().balance
    db.close()

    client.put(f"/tasks/{task_id}/complete", headers=token("customer@check.ru"))

    db = SessionLocal()
    after = db.query(User).filter(User.id == ids[email]).first().balance
    db.close()
    return BUDGET - (after - before)


print("=" * 68)
print("ПРОВЕРКА: права по сроку подписки (is_pro_active), а не по флагу")
print("=" * 68)

print("\n1. Отклики при исчерпанных кредитах")
r = client.post(f"/tasks/{open_task_id}/responses", headers=token("expired@check.ru"),
                json={"text": "беру", "proposed_price": 9000})
check("истёкшая PRO не даёт бесплатный отклик", r.status_code == 402, f"http={r.status_code}")

r = client.post(f"/tasks/{open_task_id}/responses", headers=token("broken@check.ru"),
                json={"text": "беру", "proposed_price": 9000})
check("флаг без срока не даёт бесплатный отклик", r.status_code == 402, f"http={r.status_code}")

r = client.post(f"/tasks/{open_task_id}/responses", headers=token("active@check.ru"),
                json={"text": "беру", "proposed_price": 9000})
check("действующая PRO отклик пропускает", r.status_code == 200, f"http={r.status_code}")

print("\n2. Комиссия при завершении сделки")
fee_expired = complete_for("expired@check.ru")
check("истёкшая PRO платит стандартную комиссию",
      fee_expired == BUDGET * FEE_PERCENT // 100, f"комиссия={fee_expired}")

fee_active = complete_for("active@check.ru")
check("действующая PRO комиссию не платит", fee_active == 0, f"комиссия={fee_active}")

fee_plain = complete_for("plain@check.ru")
check("без PRO — стандартная комиссия",
      fee_plain == BUDGET * FEE_PERCENT // 100, f"комиссия={fee_plain}")

print("\n3. Метка PRO в профиле")
r = client.get("/users/me", headers=token("expired@check.ru"))
check("истёкшая PRO: is_pro=False в профиле", r.json().get("is_pro") is False,
      f"is_pro={r.json().get('is_pro')}")

r = client.get("/users/me", headers=token("broken@check.ru"))
check("флаг без срока: is_pro=False в профиле", r.json().get("is_pro") is False,
      f"is_pro={r.json().get('is_pro')}")

r = client.get("/users/me", headers=token("active@check.ru"))
check("действующая PRO: is_pro=True в профиле", r.json().get("is_pro") is True,
      f"is_pro={r.json().get('is_pro')}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
