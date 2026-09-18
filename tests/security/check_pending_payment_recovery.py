"""
РЕГРЕСС: платёж, прошедший у провайдера, но не зачисленный.

Запуск (из корня репозитория):
    python tests/security/check_pending_payment_recovery.py

Код возврата: 0 — восстановление работает, 1 — платёж теряется,
2 — зачисление не идемпотентно (двойное начисление).

Что было
--------
Зачисление держалось на двух путях, и оба отказывали молча:

1. **Вебхук.** Его адрес настраивается в кабинете ЮMoney отдельно от кода.
   Пока там указан старый домен, уведомления не приходят вообще: на нашей
   стороне нет ни ошибки, ни строки в логе — только непополненный баланс.
2. **Возврат плательщика в браузере.** `successURL` ведёт на
   `/profile?payment=return`, и страница читала `payment_id` из
   `sessionStorage`. На iOS форма оплаты открывается отдельной вкладкой,
   а хранилище сеанса между вкладками не переезжает — подтверждение молча
   пропускалось. Кнопка «Проверить оплату» жила только внутри модального
   окна, и вместе с ним исчезала при перезагрузке: восстановить платёж из
   интерфейса было нечем.

Наблюдаемый результат у пользователя: деньги со счёта списались, баланс в
профиле не изменился, обращений в поддержку — ноль (он просто попробует ещё
раз).

Что стало
---------
`POST /payments/confirm-pending` — дозачисление по НАШИМ записям
`PaymentRecord` текущего пользователя плюс ответ провайдера. Из запроса не
принимается ничего, поэтому перебрать чужие платежи или зачислить
неоплаченный этим вызовом нельзя.

Что проверяет этот скрипт
-------------------------
1. оплаченный и незачисленный платёж — дозачисляется;
2. повторный вызов — идемпотентен, второй раз не начисляет (иначе фикс
   превратился бы в способ печатать деньги);
3. неоплаченный платёж — не зачисляется;
4. чужой платёж — не зачисляется и не помечается оплаченным;
5. ошибка провайдера — вызов не падает и ничего не зачисляет;
6. платёж старше окна проверки — не трогается (окно ограничивает число
   обращений к провайдеру);
7. транзакция и уведомление создаются вместе с зачислением;
8. `/health/db` отвечает 200 — эндпоинт, который всегда отдавал 503 из-за
   голой строки в `execute()`.
"""
import os
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("check_pending_payment")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.integrations import yoomoney  # noqa: E402
from app.models import (  # noqa: E402
    User, UserRole, PaymentRecord, PaymentStatus, Transaction, Notification,
)

Base.metadata.create_all(bind=engine)


def _make_user(email: str, balance: int = 0) -> int:
    db = SessionLocal()
    user = User(email=email, hashed_password="x", role=UserRole.customer, balance=balance)
    db.add(user)
    db.commit()
    uid = user.id
    db.close()
    return uid


def _balance(uid: int) -> int:
    db = SessionLocal()
    value = db.query(User).filter(User.id == uid).first().balance
    db.close()
    return value


def _add_payment(uid: int, label: str, amount: int, hours_ago: int = 0) -> int:
    db = SessionLocal()
    record = PaymentRecord(
        payment_id=label,
        user_id=uid,
        amount=amount,
        provider="yoomoney",
        status=PaymentStatus.created,
        confirmation_url=f"https://yoomoney.ru/quickpay/confirm.xml?label={label}",
        created_at=datetime.utcnow() - timedelta(hours=hours_ago),
    )
    db.add(record)
    db.commit()
    rid = record.id
    db.close()
    return rid


def _record(rid: int):
    db = SessionLocal()
    row = db.query(PaymentRecord).filter(PaymentRecord.id == rid).first()
    db.close()
    return row


# --- Сцена: у провайдера оплачено, у нас — нет ------------------------------
me = _make_user("payer@delo.ru")
stranger = _make_user("stranger@delo.ru")

PAID = _add_payment(me, "delo_paid_0001", 100)            # оплачен, не зачислен
UNPAID = _add_payment(me, "delo_unpaid_0002", 700)        # не оплачен
FOREIGN = _add_payment(stranger, "delo_foreign_0003", 500)  # оплачен, но чужой
STALE = _add_payment(me, "delo_stale_0004", 300, hours_ago=24 * 10)  # вне окна

# Провайдер отвечает по каждому label так, как ответил бы ЮMoney.
PROVIDER = {
    "delo_paid_0001": {"status": "success", "paid": True, "amount": 100},
    "delo_unpaid_0002": {"status": "not_found", "paid": False},
    "delo_foreign_0003": {"status": "success", "paid": True, "amount": 500},
    "delo_stale_0004": {"status": "success", "paid": True, "amount": 300},
}
yoomoney.get_payment_status = lambda pid: PROVIDER.get(
    pid, {"status": "not_found", "paid": False}
)

client = TestClient(main.app)
token = create_access_token({"sub": str(me)})
headers = {"Authorization": f"Bearer {token}"}

print("=" * 68)
print("РЕГРЕСС: дозачисление платежа, прошедшего у провайдера")
print("=" * 68)

before = _balance(me)
r1 = client.post("/payments/confirm-pending", headers=headers)
after1 = _balance(me)
body1 = r1.json() if r1.status_code == 200 else {}

print("1. Оплаченный незачисленный платёж")
print(f"   http={r1.status_code}  {str(body1)[:140]}")
print(f"   баланс: {before} -> {after1}   (зачислено {after1 - before})")
print(f"   checked={body1.get('checked')}  total={body1.get('total')}")

# Повторный вызов: деньги те же, начисления быть не должно.
r2 = client.post("/payments/confirm-pending", headers=headers)
after2 = _balance(me)
print()
print("2. Повторный вызов (идемпотентность)")
print(f"   http={r2.status_code}  {str(r2.json())[:140]}")
print(f"   баланс: {after1} -> {after2}   (начислено повторно {after2 - after1})")

foreign_balance = _balance(stranger)
foreign_row = _record(FOREIGN)
print()
print("3. Чужой платёж")
print(f"   баланс постороннего: {foreign_balance}   credited_at={foreign_row.credited_at}")

unpaid_row = _record(UNPAID)
print()
print("4. Неоплаченный платёж")
print(f"   credited_at={unpaid_row.credited_at}  (должно быть None)")

stale_row = _record(STALE)
print()
print("5. Платёж вне окна проверки (240 часов)")
print(f"   credited_at={stale_row.credited_at}  (должно быть None)")

db = SessionLocal()
tx_count = db.query(Transaction).filter(Transaction.user_id == me).count()
notif_count = db.query(Notification).filter(Notification.user_id == me).count()
db.close()
print()
print("6. Следы зачисления")
print(f"   транзакций у пользователя: {tx_count}  уведомлений: {notif_count}")

# Ошибка провайдера не должна ни зачислять, ни ронять вызов.
db = SessionLocal()
db.add(PaymentRecord(
    payment_id="delo_error_0005", user_id=me, amount=900, provider="yoomoney",
    status=PaymentStatus.created, confirmation_url="https://yoomoney.ru/x",
    created_at=datetime.utcnow(),
))
db.commit()
db.close()
PROVIDER["delo_error_0005"] = {"error": "HTTP 401"}
yoomoney.get_payment_status = lambda pid: PROVIDER.get(
    pid, {"status": "not_found", "paid": False}
)

balance_before_error = _balance(me)
r3 = client.post("/payments/confirm-pending", headers=headers)
balance_after_error = _balance(me)
print()
print("7. Провайдер ответил ошибкой")
print(f"   http={r3.status_code}  {str(r3.json())[:140]}")
print(f"   баланс: {balance_before_error} -> {balance_after_error}")

health = client.get("/health/db")
print()
print("8. /health/db")
print(f"   http={health.status_code}  {health.text[:120]}")

# --- Провайдер: платёж пришёл не депозитом ---------------------------------
# `check_payment` искал операцию только среди пополнений (`type=deposition`).
# Платёж, пришедший переводом, не находился никогда: подтверждение из
# браузера возвращало `not_found`, и зачисление не проходило.
os.environ["YOOMONEY_ACCESS_TOKEN"] = "self-contained-test-token"
provider_client = yoomoney.YooMoneyClient()

calls = []
_real_post = yoomoney.requests.post


class _FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def _fake_post(url, headers=None, data=None, timeout=None):
    calls.append(dict(data or {}))
    if (data or {}).get("type") == "deposition":
        return _FakeResponse({"operations": []})
    return _FakeResponse({"operations": [
        {
            "label": "delo_transfer_0006",
            "status": "success",
            "amount": "100.00",
            "operation_id": "op-1",
            "datetime": "2026-09-18T12:00:00Z",
            "sender": "410011000000",
        },
    ]})


yoomoney.requests.post = _fake_post
try:
    transfer = provider_client.check_payment("delo_transfer_0006")
    narrow_calls = len(calls)
    calls.clear()

    def _fake_post_nothing(url, headers=None, data=None, timeout=None):
        calls.append(dict(data or {}))
        return _FakeResponse({"operations": []})

    yoomoney.requests.post = _fake_post_nothing
    missing = provider_client.check_payment("delo_nowhere_0007")
    broad_calls = len(calls)
finally:
    yoomoney.requests.post = _real_post

print()
print("9. Платёж пришёл не депозитом (переводом)")
print(f"   paid={transfer.get('paid')}  amount={transfer.get('amount')}")
print(f"   запросов к провайдеру: {narrow_calls} (узкий, затем широкий)")
print("10. Операции нет ни в узком, ни в широком поиске")
print(f"   paid={missing.get('paid')}  запросов: {broad_calls}")

# --- Доступ: эндпоинт двигает деньги ---------------------------------------
# Зачисление без аутентификации означало бы, что чужой баланс можно
# пополнить (или, при ошибке в фильтре, увидеть чужие платежи) одним
# запросом без токена.
balance_before_auth = _balance(me)
r_noauth = client.post("/payments/confirm-pending")
r_badtoken = client.post(
    "/payments/confirm-pending",
    headers={"Authorization": "Bearer not-a-real-token"},
)
balance_after_auth = _balance(me)

print()
print("11. Доступ")
print(f"   без токена:        HTTP {r_noauth.status_code}  (ожидается 401)")
print(f"   с битым токеном:   HTTP {r_badtoken.status_code}  (ожидается 401 или 403)")
print(f"   баланс: {balance_before_auth} -> {balance_after_auth}")

print()
failures = []

if after1 - before != 100:
    failures.append(
        f"платёж не дозачислен: ожидалось +100, получено {after1 - before}"
    )
if body1.get("total") != 100 or not body1.get("credited"):
    failures.append(f"ответ не сообщает о зачислении: {body1}")

if after2 != after1:
    print(f"НЕ ИДЕМПОТЕНТНО: повторный вызов начислил ещё {after2 - after1} ₽.")
    print("  Это способ печатать деньги повторным нажатием кнопки.")
    sys.exit(2)

if foreign_balance != 0 or foreign_row.credited_at is not None:
    failures.append(
        f"чужой платёж затронут: баланс={foreign_balance}, "
        f"credited_at={foreign_row.credited_at}"
    )

if unpaid_row.credited_at is not None:
    failures.append("неоплаченный платёж помечен зачисленным")

if stale_row.credited_at is not None:
    failures.append("платёж старше окна проверки всё равно обработан")

if tx_count < 1 or notif_count < 1:
    failures.append(
        f"зачисление без следов: транзакций={tx_count}, уведомлений={notif_count}"
    )

if r3.status_code != 200:
    failures.append(f"ошибка провайдера уронила вызов: http={r3.status_code}")

if balance_after_error != balance_before_error:
    failures.append("при ошибке провайдера всё равно зачислено")

if health.status_code != 200:
    failures.append(
        f"/health/db отдаёт {health.status_code} — проверка живости базы сломана"
    )

if not transfer.get("paid"):
    failures.append(
        "платёж, пришедший переводом, не находится — браузерное подтверждение "
        "для него не сработает никогда"
    )

if narrow_calls != 2:
    failures.append(
        f"поиск операции сделан за {narrow_calls} запроса вместо 2 "
        f"(узкий по типу, затем широкий)"
    )

if missing.get("paid") or broad_calls != 2:
    failures.append(
        f"отсутствующая операция обработана неверно: paid={missing.get('paid')}, "
        f"запросов={broad_calls}"
    )

if r_noauth.status_code != 401:
    failures.append(
        f"эндпоинт доступен без токена: HTTP {r_noauth.status_code}"
    )

if r_badtoken.status_code not in (401, 403):
    failures.append(
        f"битый токен принят: HTTP {r_badtoken.status_code}"
    )

if balance_after_auth != balance_before_auth:
    failures.append("неаутентифицированный запрос всё равно изменил баланс")

if failures:
    print("НАЙДЕНЫ ДЕФЕКТЫ:")
    for item in failures:
        print(f"  - {item}")
    sys.exit(1)

print("Восстановление работает: оплаченный платёж дозачисляется,")
print("повторный вызов ничего не начисляет, чужое и неоплаченное не трогается.")
sys.exit(0)
