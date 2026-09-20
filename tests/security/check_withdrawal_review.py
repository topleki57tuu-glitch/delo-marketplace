"""
Регресс: решение модератора по заявке на вывод средств.

Запуск (из корня репозитория):
    python tests/security/check_withdrawal_review.py

Код возврата: 0 — деньги двигаются правильно, 1 — расхождение.

Почему этот файл существует
---------------------------
`POST /admin/withdrawals/{id}/review` — единственный роут, который двигает
деньги, и до сих пор его не вызывал **ни один** файл в `tests/`. Проверялись
соседние вещи: создание заявки (`test_csrf_coverage`), список заявок и отказ
постороннему (`check_admin_password_change`), сериализация пустого статуса
(`check_enum_null_serialization`). Само решение — одобрить выплату или
отклонить и вернуть деньги — не проверялось ничем.

То есть правку, которая заставила бы отклонение возвращать сумму дважды,
можно было откатить молча. Ровно тот сценарий, ради которого пишутся наборы.

Как устроен вывод и что из этого следует
----------------------------------------
Модель — как у эскроу: сумма списывается с баланса **в момент подачи** заявки,
а не в момент решения модератора. Иначе пользователь подал бы заявку на
50 000, потратил баланс на пакеты откликов и ушёл в минус к тому моменту,
когда модератор нажмёт «выплачено».

Отсюда два разных ожидания, которые легко перепутать и которые здесь
проверяются отдельно:

* **одобрение** баланс не меняет — деньги уже списаны при подаче;
* **отклонение** баланс возвращает — и ровно один раз.

Из этого же следует, что проверять баланс «равен исходному» нельзя: каждая
**выплаченная** заявка уменьшает деньги пользователя навсегда. Поэтому здесь
ведётся ожидаемый баланс (`expected`), который двигается на каждом шаге, —
а не сравнивается с константой. Первая редакция набора так и ошиблась: пять
проверок падали на арифметике самого теста, а не на поведении приложения.

Что проверяется
---------------
1. Решить заявку может только модератор: посторонний и сам владелец — 403;
   несуществующая заявка — 404; неизвестное действие — 400;
2. одобрение переводит заявку в `paid`, заполняет `resolved_at` и **не**
   начисляет ничего на баланс;
3. повторное решение по обработанной заявке — 400, и баланс не двигается;
4. отклонение возвращает сумму на баланс, пишет `Transaction` типа
   `withdraw_refund` и уведомляет владельца;
5. повторное отклонение не возвращает сумму второй раз — главная проверка;
6. заявку, отменённую пользователем, нельзя одобрить; одобренную нельзя
   отменить — и деньги при этом не двигаются;
7. реквизиты: владелец видит маску, модератор — полный номер, и полный номер
   не попадает в ответ владельцу;
8. инвариант сохранения: баланс плюс замороженные заявки меняется ровно на
   то, что ушло наружу выплатами, — ни рублём больше.

Чего этот набор НЕ доказывает
-----------------------------
Он последовательный. Защита от двух одновременных нажатий «отклонить»
(`_claim_status` делает переход через условный UPDATE и смотрит rowcount)
здесь проверяется только по последствиям: второй вызов видит уже не-pending
статус и возвращает 400. Так же повела бы себя и наивная реализация
«прочитал — проверил — записал», поэтому сам факт атомарности этот набор не
подтверждает. Настоящая гонка двух запросов — отдельная работа с потоками
и общей базой (см. раздел «Что осталось непроверенным» в отчёте).
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Модераторов в самодостаточных наборах нет вовсе (ADMIN_EMAILS не задан —
# так задумано, см. app/core/config.py), поэтому список задаём сами.
# Окружение выставляется до импорта main: settings читает ADMIN_EMAILS
# на импорте.
MODERATOR_EMAIL = "moderator@withdraw.ru"
isolate_env("check_withdrawal_review", ADMIN_EMAILS=MODERATOR_EMAIL)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import (  # noqa: E402
    Notification, Transaction, TransactionType,
    User, UserRole, WithdrawalRequest, WithdrawalStatus,
)

OWNER = "spec@withdraw.ru"
STRANGER = "stranger@withdraw.ru"
START_BALANCE = 20_000
AMOUNT = 5_000
CARD = "4111111111111111"

passed = 0
failed = 0

# Ожидаемый баланс владельца. Двигается на каждом шаге:
#   подача заявки  -> минус сумма (деньги заморожены)
#   одобрение      -> без изменений (деньги ушли наружу навсегда)
#   отклонение     -> плюс сумма (возврат)
#   отмена         -> плюс сумма (возврат)
expected = START_BALANCE


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
owner = User(email=OWNER, hashed_password="x",
             role=UserRole.specialist, name="Специалист", balance=START_BALANCE)
moderator = User(email=MODERATOR_EMAIL, hashed_password="x",
                 role=UserRole.customer, name="Модератор", balance=0)
stranger = User(email=STRANGER, hashed_password="x",
                role=UserRole.customer, name="Посторонний", balance=0)
db.add_all([owner, moderator, stranger])
db.commit()

ids = {u.email: u.id for u in (owner, moderator, stranger)}
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def auth(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[email])})}"}


def balance(email: str = OWNER) -> int:
    session = SessionLocal()
    try:
        return session.query(User).filter(User.id == ids[email]).first().balance or 0
    finally:
        session.close()


def request_row(rid: int):
    session = SessionLocal()
    try:
        return session.query(WithdrawalRequest).filter(WithdrawalRequest.id == rid).first()
    finally:
        session.close()


def request_status(rid: int) -> str:
    row = request_row(rid)
    return row.status.value if row else "нет заявки"


def pending_amount() -> int:
    """Сколько денег сейчас заморожено под необработанные заявки."""
    session = SessionLocal()
    try:
        rows = session.query(WithdrawalRequest).filter(
            WithdrawalRequest.status == WithdrawalStatus.pending
        ).all()
        return sum(r.amount for r in rows)
    finally:
        session.close()


def refund_count() -> int:
    """Сколько записей о возврате заявки на вывод у владельца."""
    session = SessionLocal()
    try:
        return session.query(Transaction).filter(
            Transaction.user_id == ids[OWNER],
            Transaction.type == TransactionType.withdraw_refund,
        ).count()
    finally:
        session.close()


def hold_count() -> int:
    """Сколько записей о заморозке под заявку у владельца."""
    session = SessionLocal()
    try:
        return session.query(Transaction).filter(
            Transaction.user_id == ids[OWNER],
            Transaction.type == TransactionType.withdraw_hold,
        ).count()
    finally:
        session.close()


def withdrawal_notifications() -> int:
    session = SessionLocal()
    try:
        return session.query(Notification).filter(
            Notification.user_id == ids[OWNER],
            Notification.type == "withdrawal",
        ).count()
    finally:
        session.close()


def check_balance(label: str) -> None:
    """Баланс совпадает с ожидаемым."""
    actual = balance()
    check(label, actual == expected, f"баланс={actual}, ожидалось {expected}")


def open_request(amount: int = AMOUNT) -> int:
    """Подаёт заявку на вывод: сумма уходит с баланса в заморозку."""
    global expected
    r = client.post("/wallet/withdraw",
                    json={"amount": amount, "method": "card", "requisites": CARD},
                    headers=auth(OWNER))
    if r.status_code != 200:
        print(f"  !! не удалось подать заявку: {r.status_code} {r.text[:160]}")
        sys.exit(2)
    expected -= amount
    return r.json()["id"]


def review(rid: int, action: str, as_email: str = MODERATOR_EMAIL, comment: str = None):
    body = {"action": action}
    if comment is not None:
        body["comment"] = comment
    return client.post(f"/admin/withdrawals/{rid}/review", json=body,
                       headers=auth(as_email))


# ---------------------------------------------------------------------------
print("\n1. Решить заявку может только модератор")

rid = open_request()
check("заявка создана и ждёт решения", request_status(rid) == "pending", request_status(rid))
check("сумма ушла с баланса в заморозку", balance() == START_BALANCE - AMOUNT,
      f"баланс={balance()}")
check("заявка видна в замороженных", pending_amount() == AMOUNT, f"заморожено={pending_amount()}")

r = review(rid, "approve", as_email=STRANGER)
check("посторонний получает 403", r.status_code == 403, f"http={r.status_code}")

r = review(rid, "approve", as_email=OWNER)
check("владелец не может одобрить свою же заявку", r.status_code == 403,
      f"http={r.status_code} {r.text[:80]}")
check("после двух отказов заявка всё ещё ждёт решения",
      request_status(rid) == "pending", request_status(rid))

r = review(999_999, "approve")
check("несуществующая заявка — 404", r.status_code == 404, f"http={r.status_code}")

r = review(rid, "перевести_всё_мне")
check("неизвестное действие — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check("неизвестное действие не сдвинуло заявку",
      request_status(rid) == "pending", request_status(rid))
check_balance("после отказов в доступе баланс не изменился")

# ---------------------------------------------------------------------------
print("\n2. Одобрение: деньги не начисляются повторно")

before = balance()
refunds_before = refund_count()
notifications_before = withdrawal_notifications()

r = review(rid, "approve", comment="Выплачено 20.09")
check("одобрение отвечает 200", r.status_code == 200, f"http={r.status_code} {r.text[:120]}")
body = r.json() if r.status_code == 200 else {}
check("статус заявки — paid", body.get("status") == "paid", f"status={body.get('status')!r}")
check("в ответе refunded=0", body.get("refunded") == 0, f"refunded={body.get('refunded')!r}")
check("статус в базе — paid", request_status(rid) == "paid", request_status(rid))

row = request_row(rid)
check("resolved_at заполнен", row is not None and row.resolved_at is not None,
      f"resolved_at={getattr(row, 'resolved_at', None)}")
check("комментарий модератора сохранён",
      row is not None and row.comment == "Выплачено 20.09",
      f"comment={getattr(row, 'comment', None)!r}")

check("баланс при одобрении не изменился", balance() == before,
      f"было {before}, стало {balance()}")
check("деньги не вернулись на баланс", refund_count() == refunds_before,
      f"возвратов={refund_count()}")
check("владельцу ушло уведомление о выплате",
      withdrawal_notifications() > notifications_before,
      f"уведомлений={withdrawal_notifications()}")
check_balance("одобрение не тронуло баланс")
check("замороженных заявок не осталось", pending_amount() == 0, f"заморожено={pending_amount()}")

# ---------------------------------------------------------------------------
print("\n3. Повторное решение по обработанной заявке")

r = review(rid, "approve")
check("повторное одобрение — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check("отклонить одобренную заявку — 400", review(rid, "reject").status_code == 400,
      f"http={review(rid, 'reject').status_code}")
check_balance("повторы решения не сдвинули баланс")
check("возвратов по-прежнему нет", refund_count() == refunds_before,
      f"возвратов={refund_count()}")

# ---------------------------------------------------------------------------
print("\n4. Отклонение возвращает деньги")

rid2 = open_request()
check("сумма снова заморожена", balance() == expected and pending_amount() == AMOUNT,
      f"баланс={balance()}, заморожено={pending_amount()}")
check("появилась вторая запись о заморозке", hold_count() == 2, f"заморозок={hold_count()}")

refunds_before = refund_count()
held = balance()

r = review(rid2, "reject", comment="Неверные реквизиты")
check("отклонение отвечает 200", r.status_code == 200, f"http={r.status_code} {r.text[:120]}")
body = r.json() if r.status_code == 200 else {}
check("статус заявки — rejected", body.get("status") == "rejected", f"status={body.get('status')!r}")
check("в ответе refunded = сумма заявки", body.get("refunded") == AMOUNT,
      f"refunded={body.get('refunded')!r}")
check("статус в базе — rejected", request_status(rid2) == "rejected", request_status(rid2))

expected += AMOUNT  # возврат
check("сумма вернулась на баланс ровно один раз", balance() == held + AMOUNT,
      f"было {held}, стало {balance()}, ожидалось {held + AMOUNT}")
check_balance("баланс совпадает с учётом возврата")
check("появилась запись withdraw_refund", refund_count() == refunds_before + 1,
      f"возвратов={refund_count()}")

row2 = request_row(rid2)
check("причина отклонения сохранена",
      row2 is not None and row2.comment == "Неверные реквизиты",
      f"comment={getattr(row2, 'comment', None)!r}")

# ---------------------------------------------------------------------------
print("\n5. Повторное отклонение не возвращает сумму второй раз")

r = review(rid2, "reject")
check("повторное отклонение — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check_balance("баланс не вырос второй раз")
check("второй записи о возврате не появилось", refund_count() == refunds_before + 1,
      f"возвратов={refund_count()}")

r = review(rid2, "approve")
check("одобрить отклонённую заявку нельзя — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check_balance("баланс не сдвинулся и после этого")

# ---------------------------------------------------------------------------
print("\n6. Отмена пользователем и решение модератора не пересекаются")

rid3 = open_request()
r = client.post(f"/wallet/withdrawals/{rid3}/cancel", headers=auth(OWNER))
check("пользователь отменил заявку", r.status_code == 200,
      f"http={r.status_code} {r.text[:80]}")
check("статус — cancelled", request_status(rid3) == "cancelled", request_status(rid3))

expected += AMOUNT  # возврат по отмене
check_balance("отмена вернула сумму на баланс")

r = review(rid3, "approve")
check("отменённую заявку нельзя одобрить — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check("отменённую заявку нельзя отклонить — 400", review(rid3, "reject").status_code == 400)
check_balance("после отказов по отменённой заявке баланс не сдвинулся")

rid4 = open_request()
check("одобряем четвёртую заявку", review(rid4, "approve").status_code == 200)
check_balance("баланс после одобрения не изменился")

r = client.post(f"/wallet/withdrawals/{rid4}/cancel", headers=auth(OWNER))
check("выплаченную заявку нельзя отменить — 400", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check_balance("отказ в отмене не вернул деньги")

# ---------------------------------------------------------------------------
print("\n7. Реквизиты: владельцу маска, модератору полный номер")

r = client.get("/wallet/withdrawals", headers=auth(OWNER))
own = r.json() if r.status_code == 200 else []
check("владелец получил список своих заявок", r.status_code == 200 and len(own) > 0,
      f"http={r.status_code}, заявок={len(own)}")
own_req = [w.get("requisites") for w in own if w.get("requisites")]
check("в ответе владельцу нет полного номера карты",
      all(CARD not in str(v) for v in own_req),
      f"пример={own_req[0]!r}" if own_req else "реквизитов нет")
check("владельцу показаны последние 4 цифры",
      all(str(v).endswith(CARD[-4:]) for v in own_req),
      f"пример={own_req[0]!r}" if own_req else "реквизитов нет")

r = client.get("/admin/withdrawals", headers=auth(MODERATOR_EMAIL))
admin_list = r.json() if r.status_code == 200 else []
check("модератор получил список", r.status_code == 200 and len(admin_list) > 0,
      f"http={r.status_code}, заявок={len(admin_list)}")
admin_req = [w.get("requisites") for w in admin_list if w.get("requisites")]
check("модератор видит полный номер — иначе выплату не сделать",
      any(str(v) == CARD for v in admin_req),
      f"пример={admin_req[0]!r}" if admin_req else "реквизитов нет")
check("в списке модератора есть почта владельца",
      all(w.get("user_email") for w in admin_list),
      f"первая={admin_list[0].get('user_email')!r}" if admin_list else "списка нет")

r = client.get("/admin/withdrawals", headers=auth(STRANGER))
check("посторонний не получает очередь выплат с реквизитами",
      r.status_code == 403, f"http={r.status_code}")

# ---------------------------------------------------------------------------
print("\n8. Деньги в системе сохраняются")

# Две заявки выплачены — эти деньги ушли наружу и не должны вернуться.
paid_out = 2 * AMOUNT
total = balance() + pending_amount()
check("баланс + замороженные заявки = исходное минус выплаченное",
      total == START_BALANCE - paid_out,
      f"итого={total}, ожидалось {START_BALANCE - paid_out} "
      f"(баланс={balance()}, в заявках={pending_amount()})")
check("необработанных заявок не осталось", pending_amount() == 0,
      f"заморожено={pending_amount()}")
check("заморозок было четыре, возвратов — два",
      hold_count() == 4 and refund_count() == 2,
      f"заморозок={hold_count()}, возвратов={refund_count()}")

paid_count = sum(1 for w in admin_list if w.get("status") == "paid")
check("две заявки выплачены, две закрыты без выплаты",
      paid_count == 2, f"выплачено={paid_count}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
