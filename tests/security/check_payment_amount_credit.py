"""
Регресс: зачисляется фактически уплаченная сумма, а не запрошенная.

Запуск (из корня репозитория):
    python tests/security/check_payment_amount_credit.py

Код возврата: 0 — зачисление ограничено уплаченным, 1 — можно оплатить меньше
и получить больше.

Почему этот файл существует
---------------------------
Сумма, которую пользователь просит зачислить, попадает в браузер: она едет
параметром `sum` в адресе формы ЮMoney (`request_payment` собирает URL из
`receiver`, `sum`, `label`). Значит, `sum` правится в адресной строке до
открытия формы, и заплатить 100 ₽ по счёту на 100 000 ₽ можно, не подделывая
ничего: метка остаётся нашей, а подпись уведомления — подлинной, потому что
её считает ЮMoney по факту операции.

Подпись подтверждает ровно одно: уведомление пришло от ЮMoney. Совпадает ли
уплаченное с запрошенным, она не говорит.

Все три пути зачисления брали `record.amount` — то есть запрошенную сумму, —
а расхождение с фактически уплаченной только писали в лог:

* `POST /payments/webhook/yoomoney` — «crediting expected amount»;
* `POST /payments/confirm` — сумма от провайдера не читалась вообще;
* `POST /payments/confirm-pending` — то же самое.

Теперь все три берут минимум из запрошенного и уплаченного
(`app/api/payments.py::credit_amount`): больше запрошенного зачислять нельзя,
меньше уплаченного — тоже.

Что проверяется
---------------
1. вебхук: уплачено меньше запрошенного — зачисляется уплаченное (дыра);
2. вебхук: уплачено больше запрошенного — зачисляется запрошенное;
3. вебхук: уплачено ровно запрошенное — зачисляется запрошенное;
4. `POST /payments/confirm` с заниженной суммой от провайдера;
5. `POST /payments/confirm-pending` — то же;
6. провайдер сумму не сообщил — зачисляется запрошенное (живой путь не сломан);
7. таблица значений `credit_amount` — границы, ноль, мусор, отсутствие суммы.
"""
import hashlib
import os
import sys
from datetime import datetime

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Секрет подписи задаём сами и так же сами считаем подпись: проверка должна
# падать на сумме, а не на «подпись не сошлась». Секрет нужен и потому, что
# `yoomoney_client` — синглтон, созданный при импорте: окружение обязано быть
# выставлено до него.
SECRET = "self-contained-notification-secret"

# ACCESS_TOKEN намеренно НЕ задаём: вебхук работает на одном секрете подписи,
# а `enabled=False` — это штатное состояние «ЮMoney не настроен», в котором
# контур и живёт без реальных ключей.
isolate_env(
    "check_payment_amount_credit",
    YOOMONEY_NOTIFICATION_SECRET=SECRET,
    # Провайдеры намеренно не настроены — это и есть проверяемое состояние
    # (блок 8). Пустые строки, а не «переменных нет»: у того, кто запускает
    # набор, в окружении могут лежать настоящие ключи, и тогда «ненастроенный
    # провайдер» превратился бы в реальный поход в интернет.
    YOOMONEY_ACCESS_TOKEN="",
    YOOKASSA_SHOP_ID="",
    YOOKASSA_SECRET_KEY="",
)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.api.payments import credit_amount  # noqa: E402
from app.models import PaymentRecord, PaymentStatus, User, UserRole  # noqa: E402
from app.integrations import yoomoney  # noqa: E402

Base.metadata.create_all(bind=engine)

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


db = SessionLocal()
user = User(
    email="payer@check.ru",
    hashed_password="x",
    role=UserRole.customer,
    balance=0,
)
db.add(user)
db.commit()
USER_ID = user.id
db.close()

TOKEN = create_access_token({"sub": str(USER_ID)})
AUTH = {"Authorization": f"Bearer {TOKEN}"}
client = TestClient(main.app, raise_server_exceptions=False)


def balance() -> int:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == USER_ID).first().balance
    finally:
        db.close()


def record_of(label: str) -> PaymentRecord:
    db = SessionLocal()
    try:
        return db.query(PaymentRecord).filter(PaymentRecord.payment_id == label).first()
    finally:
        db.close()


def make_record(label: str, amount: int, confirmation_url: str = "") -> None:
    """Запись платежа — то, что создаёт POST /payments/create.

    Напрямую в БД, потому что `POST /payments/create` требует настроенного
    провайдера и ходил бы в интернет. Для проверки зачисления нужен факт
    существования записи, а не её происхождение.
    """
    db = SessionLocal()
    try:
        db.query(PaymentRecord).filter(PaymentRecord.payment_id == label).delete()
        db.add(PaymentRecord(
            payment_id=label,
            user_id=USER_ID,
            amount=amount,
            provider="yoomoney",
            status=PaymentStatus.created,
            confirmation_url=confirmation_url or None,
        ))
        db.commit()
    finally:
        db.close()


def sign(fields: dict) -> str:
    """SHA-1 подпись уведомления ЮMoney — порядок полей из документации."""
    check_string = "&".join([
        fields.get("notification_type", ""),
        fields.get("operation_id", ""),
        fields.get("amount", ""),
        fields.get("currency", ""),
        fields.get("datetime", ""),
        fields.get("sender", ""),
        fields.get("codepro", ""),
        SECRET,
        fields.get("label", ""),
    ])
    return hashlib.sha1(check_string.encode("utf-8")).hexdigest()


def send_webhook(label: str, notified_amount, operation_id: str):
    """Вебхук с настоящей подписью. Возвращает (ответ, сколько зачислено)."""
    fields = {
        "notification_type": "card-incoming",
        "operation_id": operation_id,
        "amount": str(notified_amount),
        "currency": "643",
        "datetime": "2026-09-20T12:00:00Z",
        "sender": "4100111111111111",
        "codepro": "false",
        "label": label,
    }
    fields["sha1_hash"] = sign(fields)
    before = balance()
    response = client.post("/payments/webhook/yoomoney", data=fields)
    return response, balance() - before


print("=" * 68)
print("ПРОВЕРКА: зачисляется уплаченная сумма, а не запрошенная")
print("=" * 68)

# ---------------------------------------------------------------------------
print("\n1. Вебхук: уплачено МЕНЬШЕ запрошенного (это и была дыра)")
# ---------------------------------------------------------------------------
# Счёт на 100 000, оплата 100. Раньше зачислялось 100 000.
make_record("delo_under_0001", 100000)
response, credited = send_webhook("delo_under_0001", 100, "op-under-1")

check("вебхук принят", response.status_code == 200, f"http={response.status_code} {response.text[:120]}")
check(
    "зачислено уплаченное, а не запрошенное",
    credited == 100,
    f"зачислено {credited} ₽ (запрошено 100000, уплачено 100)",
)
row = record_of("delo_under_0001")
check("платёж помечен зачисленным", row.credited_at is not None, f"credited_at={row.credited_at}")

# ---------------------------------------------------------------------------
print("\n2. Вебхук: уплачено БОЛЬШЕ запрошенного")
# ---------------------------------------------------------------------------
make_record("delo_over_0002", 700)
response, credited = send_webhook("delo_over_0002", 99999, "op-over-1")

check("вебхук принят", response.status_code == 200, f"http={response.status_code}")
check(
    "зачислено запрошенное, лишнее не зачислено",
    credited == 700,
    f"зачислено {credited} ₽ (запрошено 700, уплачено 99999)",
)

# ---------------------------------------------------------------------------
print("\n3. Вебхук: уплачено ровно запрошенное")
# ---------------------------------------------------------------------------
make_record("delo_exact_0003", 1500)
response, credited = send_webhook("delo_exact_0003", 1500, "op-exact-1")

check("вебхук принят", response.status_code == 200, f"http={response.status_code}")
check("зачислено ровно запрошенное", credited == 1500, f"зачислено {credited} ₽")

# ---------------------------------------------------------------------------
print("\n4. POST /payments/confirm: провайдер сообщил меньшую сумму")
# ---------------------------------------------------------------------------
# Провайдер отвечает «оплачено», но фактическая сумма — 100 при счёте 50 000.
# Раньше эта сумма не читалась вообще: зачислялось `record.amount`.
CONFIRM_URL = "https://yoomoney.ru/quickpay/confirm.xml?receiver=4100111111111111&label=delo_confirm_0004"
make_record("delo_confirm_0004", 50000, confirmation_url=CONFIRM_URL)

PROVIDER = {
    "delo_confirm_0004": {"status": "success", "paid": True, "amount": 100},
    "delo_pending_0005": {"status": "success", "paid": True, "amount": 50},
    # Провайдер не сообщил сумму — сверять не с чем, зачисляем запрошенное.
    "delo_noamount_0006": {"status": "success", "paid": True},
}
yoomoney.get_payment_status = lambda pid: PROVIDER.get(pid, {"status": "not_found", "paid": False})

before = balance()
response = client.post(
    "/payments/confirm",
    params={
        "payment_id": "delo_confirm_0004",
        "provider": "yoomoney",
        "confirmation_url": CONFIRM_URL,
    },
    headers=AUTH,
)
credited = balance() - before

check("подтверждение прошло", response.status_code == 200, f"http={response.status_code} {response.text[:120]}")
check(
    "зачислено уплаченное, а не запрошенное",
    credited == 100,
    f"зачислено {credited} ₽ (запрошено 50000, провайдер сообщил 100)",
)

# ---------------------------------------------------------------------------
print("\n5. POST /payments/confirm-pending: то же самое")
# ---------------------------------------------------------------------------
PEND_URL = "https://yoomoney.ru/quickpay/confirm.xml?receiver=4100111111111111&label=delo_pending_0005"
make_record("delo_pending_0005", 30000, confirmation_url=PEND_URL)

before = balance()
response = client.post("/payments/confirm-pending", headers=AUTH)
credited = balance() - before

check("дозачисление прошло", response.status_code == 200, f"http={response.status_code} {response.text[:120]}")
check(
    "зачислено уплаченное, а не запрошенное",
    credited == 50,
    f"зачислено {credited} ₽ (запрошено 30000, провайдер сообщил 50)",
)

# ---------------------------------------------------------------------------
print("\n6. Провайдер сумму не сообщил — живой путь не сломан")
# ---------------------------------------------------------------------------
NOAMT_URL = "https://yoomoney.ru/quickpay/confirm.xml?receiver=4100111111111111&label=delo_noamount_0006"
make_record("delo_noamount_0006", 2000, confirmation_url=NOAMT_URL)

before = balance()
response = client.post(
    "/payments/confirm",
    params={
        "payment_id": "delo_noamount_0006",
        "provider": "yoomoney",
        "confirmation_url": NOAMT_URL,
    },
    headers=AUTH,
)
credited = balance() - before

check("подтверждение прошло", response.status_code == 200, f"http={response.status_code}")
check(
    "сумма не сообщена — зачислено запрошенное, а не ноль",
    credited == 2000,
    f"зачислено {credited} ₽ (запрошено 2000)",
)

# ---------------------------------------------------------------------------
print("\n7. Таблица значений credit_amount")
# ---------------------------------------------------------------------------
CASES = [
    # (запрошено, уплачено, ожидаем)
    (100000, 100, 100, "уплачено меньше — зачисляем уплаченное"),
    (700, 99999, 700, "уплачено больше — зачисляем запрошенное"),
    (1500, 1500, 1500, "равны — зачисляем сумму"),
    (2000, None, 2000, "сумма не сообщена — запрошенное"),
    (2000, "", 2000, "пустая строка — как «не сообщена»"),
    (2000, "abc", 2000, "мусор вместо суммы — как «не сообщена»"),
    (2000, "100.00", 100, "строка с дробью разбирается"),
    (2000, 0, 0, "явный ноль — зачисляем ноль, это аномалия и она видна в логе"),
    (0, 500, 0, "запрошено ноль — зачислять нечего"),
    # Через API отрицательную сумму не запросить (`POST /payments/create`
    # отклоняет `amount <= 0`), но `credit_amount` — последний рубеж перед
    # изменением баланса, и здесь отрицательное значение обязано стать нулём:
    # иначе «зачисление» превратилось бы в списание.
    (-100, 500, 0, "отрицательное запрошенное не превращается в списание"),
]

for requested, paid, expected, why in CASES:
    got = credit_amount(requested, paid)
    check(
        f"credit_amount({requested}, {paid!r}) == {expected}",
        got == expected,
        f"получено {got} — {why}",
    )

# ---------------------------------------------------------------------------
print("\n8. Контур без ключей: отказ честный, а не 500")
# ---------------------------------------------------------------------------
# Вторая половина задачи про платёжный контур, которую можно закрыть без
# реальных ключей. Проверяется, что ненастроенный провайдер виден снаружи как
# понятный отказ, а не как падение: 500 здесь означал бы, что пользователь
# видит «ошибка сервера» вместо «оплата недоступна».
r = client.get("/payments/status")
check("статус провайдеров отдаётся", r.status_code == 200, f"http={r.status_code}")
if r.status_code == 200:
    status_body = r.json()
    check(
        "ЮMoney показан как ненастроенный",
        status_body.get("yoomoney", {}).get("configured") is False,
        f"configured={status_body.get('yoomoney', {}).get('configured')}",
    )
    check(
        "ЮKassa показана как ненастроенная",
        status_body.get("yookassa", {}).get("configured") is False,
        f"configured={status_body.get('yookassa', {}).get('configured')}",
    )

for provider, label in (("yoomoney", "ЮMoney"), ("yookassa", "ЮKassa")):
    r = client.post(
        "/payments/create",
        params={"provider": provider},
        json={"amount": 1000},
        headers=AUTH,
    )
    check(
        f"создание платежа через ненастроенный {label} — 400, а не 500",
        r.status_code == 400,
        f"http={r.status_code} {r.text[:120]}",
    )
    check(
        f"и в ответе сказано, что {label} не настроен",
        "не настроен" in r.text,
        f"тело={r.text[:120]!r}",
    )

r = client.post(
    "/payments/create",
    params={"provider": "sberbank"},
    json={"amount": 1000},
    headers=AUTH,
)
check(
    "неизвестный провайдер отклонён с 400",
    r.status_code == 400,
    f"http={r.status_code} {r.text[:120]}",
)

# Ненастроенный провайдер не должен создавать запись платежа: иначе в
# `PaymentRecord` копились бы строки, которые невозможно ни оплатить, ни
# подтвердить, а `confirm-pending` ходил бы по ним к провайдеру.
db = SessionLocal()
try:
    orphan = db.query(PaymentRecord).filter(PaymentRecord.user_id == USER_ID).count()
finally:
    db.close()
check(
    "отказ не оставил записей о платежах",
    orphan == 6,
    f"записей={orphan} (ожидалось 6 — по числу зачислений из блоков 1–6)",
)

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)