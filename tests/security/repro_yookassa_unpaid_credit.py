"""
РЕГРЕСС: подтверждение платежа ЮKassa без доказательства создания.

Запуск (из корня репозитория):
    python tests/security/repro_yookassa_unpaid_credit.py

Код возврата: 0 — защита работает, 1 — уязвимость жива,
2 — фикс переусердствовал и блокирует легальное подтверждение.

Было
----
`POST /payments/confirm?provider=yookassa` брал `payment_id` из query-строки
(то есть от клиента) и передавал его в `payments.get_payment_status()`,
который делает `GET /payments/{payment_id}` у провайдера. Ответ `paid: true`
пополнял баланс.

Запись `PaymentRecord` искалась по тому же значению, которое прислал клиент,
и найденная строка принималась за доказательство оплаты. `confirmation_url`
не сохранялся и не проверялся нигде — значит, подтвердить платёж можно было,
ни разу не открыв страницу оплаты. `IS_PRODUCTION` этот путь не закрывал:
он гасит только демо-пополнение `POST /wallet/deposit`.

Стало
-----
`confirmation_url` сохраняется при создании платежа (провайдер его выдал, к
клиенту он попадает только через нас) и сверяется при подтверждении —
`app/api/payments.py::_verify_local_record`. Без совпадения — 4xx.

Что проверяет этот скрипт
-------------------------
1. голый `payment_id` без `confirmation_url` — зачисления быть не должно;
2. выдуманный `confirmation_url` — зачисления быть не должно;
3. верный `confirmation_url` — зачисление обязано пройти, иначе защита
   сломала штатный путь (код возврата 2).
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("repro_yookassa")

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
STORED_URL = "https://yookassa.ru/checkout/repro-confirmation-url"
db = SessionLocal()
db.add(PaymentRecord(
    payment_id=FAKE_ID,
    user_id=uid,
    amount=50000,
    provider="yookassa",
    confirmation_url=STORED_URL,
))
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
headers = {"Authorization": f"Bearer {token}"}

# Атака 1: подтверждение голым payment_id, без confirmation_url.
# Именно этого хватало до исправления — URL не проверялся вообще.
before = SessionLocal().query(User).filter(User.id == uid).first().balance
r_bare = client.post(
    f"/payments/confirm?payment_id={FAKE_ID}&provider=yookassa",
    headers=headers,
)
after_bare = SessionLocal().query(User).filter(User.id == uid).first().balance

# Атака 2: подтверждение с ВЫДУМАННЫМ confirmation_url.
r_fake = client.post(
    f"/payments/confirm?payment_id={FAKE_ID}&provider=yookassa"
    f"&confirmation_url=https://attacker.example/not-ours",
    headers=headers,
)
after_fake = SessionLocal().query(User).filter(User.id == uid).first().balance

# Атака 3: подтверждение с ВЕРНЫМ confirmation_url — так делает честный клиент.
# Здесь важно, что защита не ломает штатный путь: реальный владелец с настоящим
# URL должен получить зачисление, иначе фикс превратился бы в отказ всем.
r_own = client.post(
    f"/payments/confirm?payment_id={FAKE_ID}&provider=yookassa"
    f"&confirmation_url={STORED_URL}",
    headers=headers,
)
after_own = SessionLocal().query(User).filter(User.id == uid).first().balance

print("=" * 68)
print("РЕПРО: ЮKassa /payments/confirm — баланс без подтверждённой оплаты")
print("=" * 68)
print("Атака 1 — голый payment_id, confirmation_url не предъявлен")
print(f"  http={r_bare.status_code}  {r_bare.text[:120]}")
print(f"  баланс: {before} -> {after_bare}   (зачислено {after_bare - before})")
print()
print("Атака 2 — подделанный confirmation_url")
print(f"  http={r_fake.status_code}  {r_fake.text[:120]}")
print(f"  баланс: {after_bare} -> {after_fake}   (зачислено {after_fake - after_bare})")
print()
print("Штатный путь — верный confirmation_url от нашего же клиента")
print(f"  http={r_own.status_code}  {r_own.text[:120]}")
print(f"  баланс: {after_fake} -> {after_own}   (зачислено {after_own - after_fake})")
print()

stolen = (after_bare - before) + (after_fake - after_bare)
if stolen > 0:
    print(f"УЯЗВИМОСТЬ ПОДТВЕРЖДЕНА: без оплаты начислено {stolen} ₽.")
    print("  Сверка confirmation_url не работает.")
    sys.exit(1)

if after_own - after_fake != 50000:
    print("ФИКС СЛИШКОМ СТРОГИЙ: уязвимость закрыта, но и легальное")
    print("  подтверждение своим confirmation_url не зачисляет деньги.")
    sys.exit(2)

print("Защита работает: без верного confirmation_url зачислений нет,")
print("штатное подтверждение проходит и начисляет 50000 ₽.")
sys.exit(0)
