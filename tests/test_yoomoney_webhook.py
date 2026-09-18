#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тест вебхука ЮMoney: подпись, зачисление, идемпотентность.

Зачем отдельный файл: до этого вебхук проверялся только чтением кода.
Живые деньги через настоящий ЮMoney прогнать нельзя, но подпись вебхука —
обычный SHA-1 от конкатенации полей плюс notification_secret, поэтому его
можно воспроизвести локально и проверить всю логику зачисления.

Что проверяем:
  1. корректная подпись → баланс зачислен ровно на сумму платежа;
  2. повторный вебхук (ЮMoney повторяет доставку при таймауте) → НЕ дублирует;
  3. неверная подпись → 403, баланс не меняется;
  4. подпись верна, но label не из нашей базы → 404 (защита от подделки метки);
  5. подписан, но с расхождением суммы → зачисляется наша записанная сумма,
     а не присланная злоумышленником;
  6. секрет не настроен → 403 (fail-closed, а не «пропускаем без проверки»).

Запуск (backend с YOOMONEY_NOTIFICATION_SECRET):
    python tests/test_yoomoney_webhook.py

Требует работающий backend и доступ к его БД (SQLite или PostgreSQL) —
строка берётся из DATABASE_URL, как у самого приложения.
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _helpers import Session  # noqa: E402

BASE = os.environ.get("DELO_BASE", "http://localhost:8000")
NOTIFICATION_SECRET = os.environ.get("YOOMONEY_NOTIFICATION_SECRET", "")

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


def sign(fields: dict, secret: str) -> str:
    """SHA-1 подпись уведомления ЮMoney в том же порядке, что и на сервере.

    Порядок из документации ЮMoney:
      notification_type & operation_id & amount & currency & datetime &
      sender & codepro & notification_secret & label
    """
    check_string = "&".join([
        fields.get("notification_type", ""),
        fields.get("operation_id", ""),
        fields.get("amount", ""),
        fields.get("currency", ""),
        fields.get("datetime", ""),
        fields.get("sender", ""),
        fields.get("codepro", ""),
        secret,
        fields.get("label", ""),
    ])
    return hashlib.sha1(check_string.encode("utf-8")).hexdigest()


_BACKEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


def db_session():
    """Сессия БД приложения — чтобы создать платёж так, как это делает API.

    Работает с той же базой, что и сервер: DATABASE_URL берётся из окружения
    (config.py резолвит относительный sqlite-путь от каталога backend).
    """
    from app.core.database import SessionLocal  # noqa: E402
    return SessionLocal()


def get_balance(s, token, user_id=None):
    r = s.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET /users/me -> {r.status_code} {r.text[:200]}"
    return r.json()["balance"]


def make_record(label, user_id, amount, provider="yoomoney"):
    """Создаёт PaymentRecord напрямую — аналог POST /payments/create.

    Идём в БД, а не в API, потому что /payments/create требует настроенного
    YOOMONEY_ACCESS_TOKEN и ходил бы в интернет. Для проверки вебхука нужен
    именно факт существования записи.
    """
    from app.models import PaymentRecord, PaymentStatus

    db = db_session()
    try:
        db.query(PaymentRecord).filter(PaymentRecord.payment_id == label).delete()
        db.add(PaymentRecord(
            payment_id=label,
            user_id=user_id,
            amount=amount,
            provider=provider,
            status=PaymentStatus.created,
        ))
        db.commit()
    finally:
        db.close()


def cleanup_record(label):
    from app.models import PaymentRecord

    db = db_session()
    try:
        db.query(PaymentRecord).filter(PaymentRecord.payment_id == label).delete()
        db.commit()
    finally:
        db.close()


def post_webhook(s, fields):
    """POST формы на вебхук. Без CSRF: это внешний вызов провайдера."""
    return s._s.post(  # noqa: SLF001 — намеренно в обход CSRF-обёртки
        f"{BASE}/payments/webhook/yoomoney",
        data=fields,
        timeout=15,
    )


def main():
    print("=== Тест вебхука ЮMoney ===\n")

    if not NOTIFICATION_SECRET:
        print("SKIP: YOOMONEY_NOTIFICATION_SECRET не задан в окружении теста.")
        print("      Backend должен быть запущен с тем же значением — иначе")
        print("      подпись, которую считает тест, не совпадёт с серверной.")
        print("      Для прогона:")
        print("        YOOMONEY_NOTIFICATION_SECRET=test-secret \\")
        print("          uvicorn main:app --port 8000        # в каталоге backend")
        print("        YOOMONEY_NOTIFICATION_SECRET=test-secret \\")
        print("          python tests/test_yoomoney_webhook.py")
        return 0

    s = Session(BASE)

    # --- Готовим пользователя с нулевым балансом ---------------------------
    import time
    ts = int(time.time())
    email = f"webhook.test.{ts}@delo-test.ru"
    password = "WebhookTest1"
    reg = s.post("/register/", json={"email": email, "password": password, "name": "Webhook Test"})
    if reg.status_code != 200:
        print(f"Не удалось зарегистрировать тестового пользователя: {reg.status_code} {reg.text[:200]}")
        return 1
    user_id = reg.json()["user_id"]
    token = s.login(email, password)
    start_balance = get_balance(s, token, user_id)
    print(f"  Пользователь id={user_id}, стартовый баланс={start_balance}\n")

    # --- 1. Корректная подпись → зачисление --------------------------------
    label = f"wh-test-ok-{ts}"
    amount = 1500
    make_record(label, user_id, amount)

    # Один dict на тело запроса; подписываем ровно его и его же отправляем.
    # Иначе подписанный и отправленный наборы могут разойтись — и вместо
    # ожидаемого кода придёт 403 «неверная подпись».
    ok_body = {
        "notification_type": "card-incoming",
        "operation_id": f"op-{ts}-1",
        "amount": str(amount),
        "currency": "643",
        "datetime": "2026-09-18T12:00:00Z",
        "sender": "",
        "codepro": "false",
        "label": label,
    }
    fields = dict(ok_body, sha1_hash=sign(ok_body, NOTIFICATION_SECRET))

    r = post_webhook(s, fields)
    check("Вебхук с верной подписью принят", r.status_code == 200, f"http={r.status_code} {r.text[:120]}")

    balance_after = get_balance(s, token, user_id)
    check(
        f"Баланс зачислен на {amount}",
        balance_after == start_balance + amount,
        f"{start_balance} -> {balance_after}",
    )

    # --- 2. Идемпотентность: повторная доставка того же уведомления ---------
    r2 = post_webhook(s, fields)
    balance_repeat = get_balance(s, token, user_id)
    check(
        "Повторный вебхук не дублирует зачисление",
        r2.status_code == 200 and balance_repeat == balance_after,
        f"баланс остался {balance_repeat}",
    )

    # --- 3. Неверная подпись ------------------------------------------------
    bad_label = f"wh-test-badsig-{ts}"
    make_record(bad_label, user_id, 999)
    bad_fields = dict(fields)
    bad_fields["label"] = bad_label
    bad_fields["sha1_hash"] = "0" * 40  # заведомо неверная подпись

    balance_before_bad = get_balance(s, token, user_id)
    r3 = post_webhook(s, bad_fields)
    balance_after_bad = get_balance(s, token, user_id)
    check(
        "Неверная подпись -> 403",
        r3.status_code == 403,
        f"http={r3.status_code}",
    )
    check(
        "При неверной подписи баланс не изменился",
        balance_after_bad == balance_before_bad,
        f"{balance_before_bad} -> {balance_after_bad}",
    )
    cleanup_record(bad_label)

    # --- 4. Валидная подпись, но label не наш ------------------------------
    # Плательщик формирует label в браузере, поэтому он может прислать чужой
    # или выдуманный label. Подпись подделать нельзя (секрета нет), но
    # проверить надо: для незнакомого label зачислять некому.
    unknown_label = f"wh-test-unknown-{ts}"
    balance_before_unknown = get_balance(s, token, user_id)

    # Собираем поля один раз и подписываем ровно то, что отправляем:
    # любое расхождение между подписанным и отправленным набором даёт 403
    # (неверная подпись) вместо ожидаемого 404, и тест проверял бы не то.
    unknown_body = {
        "notification_type": "card-incoming",
        "operation_id": f"op-{ts}-4",
        "amount": "5000",
        "currency": "643",
        "datetime": "2026-09-18T12:05:00Z",
        "sender": "",
        "codepro": "false",
        "label": unknown_label,
    }
    unknown_fields = dict(unknown_body, sha1_hash=sign(unknown_body, NOTIFICATION_SECRET))

    r4 = post_webhook(s, unknown_fields)
    balance_after_unknown = get_balance(s, token, user_id)
    check(
        "Подписанный вебхук с неизвестным label -> 404",
        r4.status_code == 404,
        f"http={r4.status_code}",
    )
    check(
        "По неизвестному label ничего не зачислено",
        balance_after_unknown == balance_before_unknown,
        f"{balance_before_unknown} -> {balance_after_unknown}",
    )

    # --- 5. Подмена суммы в подписанном уведомлении ------------------------
    # ЮMoney подписывает и amount, так что подделать сумму без секрета нельзя.
    # Но если провайдер пришлёт другую сумму (или секрет утёк), зачислять
    # надо нашу записанную, а не присланную.
    mislabel = f"wh-test-amount-{ts}"
    real_amount = 700
    make_record(mislabel, user_id, real_amount)
    balance_before_amt = get_balance(s, token, user_id)

    attacker_amount = "99999"
    amt_body = {
        "notification_type": "card-incoming",
        "operation_id": f"op-{ts}-5",
        "amount": attacker_amount,
        "currency": "643",
        "datetime": "2026-09-18T12:10:00Z",
        "sender": "",
        "codepro": "false",
        "label": mislabel,
    }
    amt_fields = dict(amt_body, sha1_hash=sign(amt_body, NOTIFICATION_SECRET))
    r5 = post_webhook(s, amt_fields)
    balance_after_amt = get_balance(s, token, user_id)
    check(
        "Зачислена записанная сумма, а не присланная",
        balance_after_amt == balance_before_amt + real_amount,
        f"+{balance_after_amt - balance_before_amt} (ожидалось +{real_amount}, прислано {attacker_amount})",
    )

    # --- 6. Секрет не настроен → fail-closed -------------------------------
    # Проверяем на уровне интеграции, а не сервера: verify_notification
    # обязан вернуть False, если секрета нет (а не «пропустить без проверки»).
    print("\n  -- Проверка fail-closed при пустом секрете --")
    from app.integrations.yoomoney import YooMoneyClient  # noqa: E402

    client = YooMoneyClient()
    client.notification_secret = ""
    check(
        "Без notification_secret подпись не считается валидной",
        client.verify_notification({"sha1_hash": "anything"}) is False,
    )

    # --- 7. successURL: возврат пользователя после оплаты ------------------
    # Пустой successURL означал, что плательщик остаётся на сайте ЮMoney и в
    # приложение не возвращается: зачисление зависело от того, нажмёт ли он
    # «Проверить оплату» сам. Проверяем, что адрес возврата собирается и
    # попадает в платёжную ссылку.
    print("\n  -- Возврат пользователя после оплаты (successURL) --")

    client = YooMoneyClient()
    client.frontend_url = "https://delo.example.ru"
    client.return_path = "/profile"
    check(
        "адрес возврата указывает на фронтенд",
        client.build_return_url() == "https://delo.example.ru/profile?payment=return",
        client.build_return_url() or "(пусто)",
    )

    # Слэши по краям часто лишние, и без нормализации получается `//profile`
    # — браузер это стерпит, а ЮMoney может отклонить как невалидный URL.
    for frontend, path, expected in [
        ("https://delo.example.ru/", "profile", "https://delo.example.ru/profile?payment=return"),
        ("https://delo.example.ru///", "//profile//", "https://delo.example.ru/profile?payment=return"),
    ]:
        client.frontend_url, client.return_path = frontend, path
        check(
            f"слэши нормализуются: {frontend!r} + {path!r}",
            client.build_return_url() == expected,
            client.build_return_url(),
        )

    # FRONTEND_URL не задан: относительный адрес ЮMoney не примет, поэтому
    # честнее вернуть пусто (остаться у себя), чем сломанный URL.
    client.frontend_url = ""
    check("без FRONTEND_URL адрес возврата пуст", client.build_return_url() == "")

    # И главное: адрес возврата действительно попадает в ссылку на оплату.
    # `enabled` выставляем руками: реального токена у теста нет, а
    # `request_payment` без него выходит раньше сборки URL. Аккаунт
    # подменяем заглушкой — иначе был бы поход в интернет за номером кошелька.
    client.frontend_url = "https://delo.example.ru"
    client.return_path = "/profile"
    client.enabled = True
    client.get_account_info = lambda: {"account": "4100111111111111"}
    result = client.request_payment(amount=500, label=f"ret-{ts}", comment="тест возврата")
    payment_url = result.get("payment_url", "")

    # Разбираем ссылку как URL, а не ищем подстроки: `successURL` кодируется
    # вместе с вложенным `?payment=return`, поэтому сырая строка выглядит как
    # `successURL=https%3A%2F%2F...%3Fpayment%3Dreturn`, и проверка на
    # незакодированный `payment=return` дала бы ложное падение.
    from urllib.parse import urlparse, parse_qs  # noqa: E402

    query = parse_qs(urlparse(payment_url).query)
    check(
        "successURL присутствует в платёжной ссылке",
        query.get("successURL") == ["https://delo.example.ru/profile?payment=return"],
        (query.get("successURL") or ["(нет)"])[0],
    )
    check(
        "label попадает в платёжную ссылку",
        query.get("label") == [f"ret-{ts}"],
        (query.get("label") or ["(нет)"])[0],
    )
    check(
        "сумма попадает в платёжную ссылку",
        query.get("sum") == ["500"],
        (query.get("sum") or ["(нет)"])[0],
    )
    check(
        "кошелёк-получатель подставлен",
        query.get("receiver") == ["4100111111111111"],
        (query.get("receiver") or ["(нет)"])[0],
    )

    # --- Уборка --------------------------------------------------------------
    cleanup_record(label)
    cleanup_record(mislabel)

    print(f"\n=== ИТОГ: passed={_passed} failed={_failed} ===")
    return 0 if _failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
