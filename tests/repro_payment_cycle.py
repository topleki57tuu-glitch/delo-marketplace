"""Репро: полный цикл оплаты на локальном стенде.

Дополняет tests/test_yoomoney_webhook.py. Тот файл проверяет вебхук (то есть
путь, которым деньги приходят САМИ), и требует запущенного uvicorn. Здесь
проверяется то, что осталось непокрытым:

  1. POST /payments/create пишет PaymentRecord ДО ухода пользователя на
     страницу оплаты. Если записи нет, вебхуку не с чем сверять label —
     и деньги клиента уходят в никуда.
  2. confirmation_url сохраняется в записи (на нём держится вся проверка
     в /payments/confirm).
  3. POST /payments/confirm без совпадающего confirmation_url -> 403.
     Иначе чужой платёж можно подтвердить, зная только payment_id.
  4. POST /payments/confirm по чужому платежу -> 403.
  5. Подтверждение платежа, который провайдер ещё не подтвердил,
     НЕ зачисляет деньги.
  6. Подтверждение уже зачисленного платежа идемпотентно (credited_at).

Чего здесь нет и быть не может без живого ЮMoney: реального похода на
yoomoney.ru. Клиент подменяется заглушкой — проверяется НАША логика, а не
доступность чужого сервиса.

Запуск:
    python tests/repro_payment_cycle.py
"""
import os
import sys
import time

os.environ.setdefault("ENV", "development")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-repro")
os.environ.setdefault("DATABASE_URL", "sqlite:///C:/tmp/repro_payment_cycle.db")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("CSRF_ENABLED", "0")
os.environ.setdefault("YOOMONEY_ACCESS_TOKEN", "test-token-for-repro")
os.environ.setdefault("YOOMONEY_NOTIFICATION_SECRET", "test-notification-secret")
os.environ.setdefault("YOOMONEY_RETURN_PATH", "/profile")
os.environ.setdefault("FRONTEND_URL", "https://delo.example.ru")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "backend"))
os.chdir(os.path.join(_ROOT, "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

_passed = 0
_failed = 0


def check(name, condition, detail=""):
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        _failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


def register_and_login(client, tag, password="PayCycle1"):
    """Регистрирует пользователя и возвращает (user_id, token)."""
    ts = int(time.time() * 1000)
    email = f"pay.cycle.{tag}.{ts}@delo-test.ru"
    reg = client.post("/register/", json={
        "email": email, "password": password, "name": f"Pay {tag}",
    })
    assert reg.status_code in (200, 201), f"register -> {reg.status_code} {reg.text[:200]}"
    # Логин — OAuth2PasswordRequestForm: form-data, поле username, не JSON.
    login = client.post("/login", data={"username": email, "password": password})
    assert login.status_code == 200, f"login -> {login.status_code} {login.text[:200]}"
    return reg.json()["user_id"], login.json()["access_token"]


class FakeYooMoney:
    """Заглушка клиента ЮMoney: без походов в интернет.

    Хранит состояние «заплатил ли пользователь» — это позволяет проверить
    и ветку «провайдер ещё не подтвердил» (paid=False), и ветку «оплачено».
    """

    def __init__(self, account="4100111111111111"):
        self.account = account
        self.paid_labels = set()
        self.created = []

    def get_account_info(self):
        return {"account": self.account}

    def request_payment(self, amount, label, comment=None):
        self.created.append({"amount": amount, "label": label, "comment": comment})
        return {
            "request_id": label,
            "status": "success",
            "payment_url": f"https://yoomoney.ru/quickpay/confirm?label={label}&sum={amount}",
            "amount": amount,
        }

    def get_payment_status(self, label):
        if label in self.paid_labels:
            return {"status": "succeeded", "paid": True, "amount": None}
        return {"status": "pending", "paid": False}


def confirm(client, headers, payment_id, confirmation_url=None, provider="yoomoney"):
    """POST /payments/confirm.

    Параметры передаются через `params`, а не склейкой строки: `confirmation_url`
    содержит `&` (у quickpay-ссылки есть `?label=...&sum=...`), и при подстановке
    в URL он разрывает запрос — сервер получает обрезанный адрес и отвечает 403
    «не совпадает с созданным». Ошибка была бы в тесте, а выглядела как баг
    приложения.
    """
    params = {"payment_id": payment_id, "provider": provider}
    if confirmation_url is not None:
        params["confirmation_url"] = confirmation_url
    return client.post("/payments/confirm", params=params, headers=headers)


def main():
    client = TestClient(app)

    from app.core.database import SessionLocal  # noqa: E402
    from app.integrations import yoomoney as yoomoney_mod  # noqa: E402
    from app.models import PaymentRecord  # noqa: E402

    fake = FakeYooMoney()
    # Подменяем внешний мир: get_account_info/request_payment — на заглушку,
    # а enabled=True, иначе create_payment выйдет раньше сборки ссылки.
    real_client = yoomoney_mod.yoomoney_client
    real_client.enabled = True
    real_client.get_account_info = fake.get_account_info
    real_client.request_payment = fake.request_payment

    def fake_status(label):
        return fake.get_payment_status(label)

    real_status = yoomoney_mod.get_payment_status
    yoomoney_mod.get_payment_status = fake_status

    print("=== Полный цикл оплаты (локальный стенд) ===\n")

    user_id, token = register_and_login(client, "main")
    hdr = {"Authorization": f"Bearer {token}"}
    print(f"  Пользователь id={user_id}\n")

    # --- 1. Создание платежа ------------------------------------------------
    print("-- Создание платежа --")
    amount = 1500
    r = client.post("/payments/create", params={"provider": "yoomoney"},
                    json={"amount": amount}, headers=hdr)
    check("POST /payments/create -> 200", r.status_code == 200,
          f"http={r.status_code} {r.text[:160]}")
    if r.status_code != 200:
        print("\nДальше идти некуда: платёж не создался.")
        return 1

    body = r.json()
    payment_id = body.get("payment_id")
    confirmation_url = body.get("confirmation_url")
    check("ответ содержит payment_id", bool(payment_id), str(payment_id))
    check("ответ содержит confirmation_url", bool(confirmation_url),
          str(confirmation_url))

    # Главное: запись в БД есть ДО того, как пользователь ушёл платить.
    db = SessionLocal()
    try:
        rec = db.query(PaymentRecord).filter(
            PaymentRecord.payment_id == payment_id).first()
        check("PaymentRecord создан при оформлении", rec is not None,
              "нет записи — вебхуку не с чем сверять label" if not rec else "")
        if rec:
            check("в записи верный user_id", rec.user_id == user_id,
                  f"{rec.user_id} vs {user_id}")
            check("в записи верная сумма", rec.amount == amount,
                  f"{rec.amount} vs {amount}")
            check("confirmation_url сохранён в записи",
                  rec.confirmation_url == confirmation_url,
                  str(rec.confirmation_url)[:60])
            check("credited_at пуст (деньги ещё не зачислены)",
                  rec.credited_at is None)
    finally:
        db.close()

    # Метка, которой ЮMoney идентифицирует платёж, должна собираться из
    # нашего user_id — иначе get_payment_status не найдёт запись.
    check("label собран как delo_<user_id>_<hex>",
          isinstance(payment_id, str) and payment_id.startswith(f"delo_{user_id}_"),
          str(payment_id))

    # --- 2. Подтверждение без confirmation_url ------------------------------
    print("\n-- Подтверждение: проверки владельца и URL --")
    r = confirm(client, hdr, payment_id)
    check("confirm без confirmation_url -> 400", r.status_code == 400,
          f"http={r.status_code} {r.text[:120]}")

    # --- 3. Подтверждение с ПОДДЕЛЬНЫМ confirmation_url ---------------------
    r = confirm(client, hdr, payment_id,
                "https://evil.example.com/pay")
    check("confirm с чужим confirmation_url -> 403", r.status_code == 403,
          f"http={r.status_code} {r.text[:120]}")

    # Ни один из отклонённых вызовов не должен был зачислить деньги.
    r = client.get("/users/me", headers=hdr)
    balance_now = r.json()["balance"]
    check("после отклонённых confirm баланс не изменился", balance_now == 0,
          f"баланс={balance_now}")

    # --- 4. Чужой платёж ----------------------------------------------------
    other_id, other_token = register_and_login(client, "other")
    other_hdr = {"Authorization": f"Bearer {other_token}"}
    r = confirm(client, other_hdr, payment_id, confirmation_url)
    check("чужой платёж нельзя подтвердить -> 403", r.status_code == 403,
          f"http={r.status_code} {r.text[:120]}")

    # --- 5. Провайдер ещё не подтвердил оплату ------------------------------
    # fake.paid_labels пуст: get_payment_status вернёт paid=False.
    r = confirm(client, hdr, payment_id, confirmation_url)
    check("неоплаченный платёж не зачисляется", r.status_code == 200,
          f"http={r.status_code} {r.text[:120]}")
    if r.status_code == 200:
        check("ответ: credited=False", r.json().get("credited") is False,
              str(r.json()))
    r = client.get("/users/me", headers=hdr)
    check("баланс всё ещё 0", r.json()["balance"] == 0,
          f"баланс={r.json()['balance']}")

    # --- 6. Провайдер подтвердил оплату -------------------------------------
    print("\n-- Оплата подтверждена провайдером --")
    fake.paid_labels.add(payment_id)
    r = confirm(client, hdr, payment_id, confirmation_url)
    check("confirm оплаченного платежа -> 200", r.status_code == 200,
          f"http={r.status_code} {r.text[:160]}")
    if r.status_code == 200:
        check("ответ: credited=True", r.json().get("credited") is True,
              str(r.json()))
        check("new_balance == сумме платежа",
              r.json().get("new_balance") == amount,
              f"{r.json().get('new_balance')} vs {amount}")

    # --- 7. Идемпотентность: повторное подтверждение ------------------------
    r = confirm(client, hdr, payment_id, confirmation_url)
    check("повторный confirm не дублирует зачисление", r.status_code == 200,
          f"http={r.status_code}")
    if r.status_code == 200:
        check("ответ: credited=False (уже зачислено)",
              r.json().get("credited") is False, str(r.json()))
    r = client.get("/users/me", headers=hdr)
    check("баланс не удвоился", r.json()["balance"] == amount,
          f"баланс={r.json()['balance']} (ожидалось {amount})")

    # Запись должна быть помечена как оплаченная — иначе вебхук, пришедший
    # позже, зачислит второй раз.
    db = SessionLocal()
    try:
        rec = db.query(PaymentRecord).filter(
            PaymentRecord.payment_id == payment_id).first()
        check("credited_at проставлен", rec is not None and rec.credited_at is not None,
              str(rec.credited_at) if rec else "записи нет")
    finally:
        db.close()

    # --- 8. Неизвестный payment_id ------------------------------------------
    r = confirm(client, hdr, "delo_1_deadbeef",
                "https://yoomoney.ru/quickpay/confirm?label=x")
    check("confirm по несуществующему платежу -> 409", r.status_code == 409,
          f"http={r.status_code} {r.text[:120]}")

    # --- 9. Отсутствие токена ------------------------------------------------
    r = client.post(f"/payments/create", json={"amount": 100})
    check("create без токена -> 401", r.status_code == 401, f"http={r.status_code}")

    # --- 10. Некорректная сумма ----------------------------------------------
    r = client.post("/payments/create", params={"provider": "yoomoney"},
                    json={"amount": 0}, headers=hdr)
    check("create с amount=0 -> 400", r.status_code == 400, f"http={r.status_code}")

    # --- Уборка -------------------------------------------------------------
    yoomoney_mod.get_payment_status = real_status
    real_client.enabled = bool(real_client.access_token)

    print(f"\n=== ИТОГ: passed={_passed} failed={_failed} ===")
    return 0 if _failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
