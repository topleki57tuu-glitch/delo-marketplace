"""
ВОСПРОИЗВЕДЕНИЕ УЯЗВИМОСТИ: зачисление баланса без оплаты через ЮKassa.

Запуск (из корня репозитория):
    python tests/security/repro_yookassa_unpaid_credit.py

Код возврата: 1 — уязвимость воспроизведена, 0 — защита работает.

Что проверяет
-------------
`POST /payments/confirm?provider=yookassa` доверяет ответу
`payments.get_payment_status(payment_id)` — единственному источнику истины о
том, оплачен ли платёж.

Проблема в том, ЧТО приходит параметром `payment_id`. В отличие от ветки
ЮMoney, где контракт чистый (`create_payment` возвращает `request_id == label`,
`check_payment(label)` ищет операцию по тому же label), ветка ЮKassa
несогласована:

    # app/api/payments.py:179 — в базу пишется ID провайдера
    payment_id = result["payment_id"]          # payments.py:98 -> data["id"]
    db.add(PaymentRecord(payment_id=payment_id, ...))

    # payments.py:104 — у провайдера запрашивается он же
    requests.get(f"{YOOKASSA_API_URL}/payments/{payment_id}")

`payment_id` возвращается пользователю в ответе `POST /payments/create` и снова
приходит от него в `/payments/confirm` как query-параметр. Никакой связи с
созданной НАМИ записью `PaymentRecord` эта проверка не использует: запись
ищется по тому же значению, которое прислал клиент, и найденная запись
принимается как подтверждение.

`confirmation_url` из ответа на создание платежа — единственное, что реально
уходит в браузер; он не сохраняется и при подтверждении не проверяется.
Поэтому подтверждение не требует, чтобы пользователь хоть раз побывал на
странице оплаты.

`settings.IS_PRODUCTION` закрывает только ДЕМО-пополнение
(`POST /wallet/deposit`) и к этому пути отношения не имеет.

Ожидаемое поведение после исправления
-------------------------------------
`/payments/confirm` обязан отказать (4xx) либо не изменить баланс.
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

os.environ.setdefault("ENV", "development")
os.environ.setdefault("SECRET_KEY", "repro-secret-not-for-production")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
DB = r"C:/tmp/repro_yookassa.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB}")

if os.path.exists(DB):
    os.remove(DB)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import payments  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import User, UserRole, PaymentRecord  # noqa: E402

Base.metadata.create_all(bind=engine)

db = SessionLocal()
user = User(email="repro@delo.ru", hashed_password="x", role=UserRole.customer, balance=0)
db.add(user)
db.commit()
uid = user.id
db.close()

# Запись о платеже — как её создаёт /payments/create. Деньги НЕ уплачены:
# пользователь не открывал confirmation_url и не вводил карту.
FAKE_ID = "repro-yookassa-id-0001"
db = SessionLocal()
db.add(PaymentRecord(payment_id=FAKE_ID, user_id=uid, amount=50000, provider="yookassa"))
db.commit()
db.close()

# Провайдер сообщает, что платёж с этим ID оплачен — ровно так ответит
# YooKassa, если ID существует и оплата прошла.
payments.get_payment_status = lambda pid: {
    "status": "succeeded",
    "paid": True,
    "amount": 50000,
    "metadata": {},
}

client = TestClient(main.app)
token = create_access_token({"sub": str(uid)})

before = SessionLocal().query(User).filter(User.id == uid).first().balance

r = client.post(
    f"/payments/confirm?payment_id={FAKE_ID}&provider=yookassa",
    headers={"Authorization": f"Bearer {token}"},
)

after = SessionLocal().query(User).filter(User.id == uid).first().balance

print("=" * 66)
print("РЕПРО: ЮKassa /payments/confirm — баланс без подтверждённой оплаты")
print("=" * 66)
print(f"баланс до:    {before}")
print(f"ответ:        http={r.status_code} {r.text[:180]}")
print(f"баланс после: {after}")
print(f"зачислено:    {after - before}")
print()

if after > before:
    print(f"УЯЗВИМОСТЬ ПОДТВЕРЖДЕНА: начислено {after - before} ₽.")
    print("  confirmation_url не проверялся; то, что пользователь реально")
    print("  оплатил платёж с этим ID, ниоткуда не следует.")
    sys.exit(1)

print("Защита работает: баланс не изменился.")
sys.exit(0)
