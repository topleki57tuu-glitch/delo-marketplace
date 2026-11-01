"""Регрессия к аудиту безопасности (ноябрь 2026).

Каждая проверка ниже падала на коде до исправлений. Самодостаточный набор:
временная SQLite-база, провайдер платежей подменён заглушкой.

  1. Платежи: N одновременных /payments/confirm (и вебхук вдогонку) по
     одному платежу зачисляют сумму ровно один раз; уведомление с
     codepro=true не зачисляется.
  2. Refresh-токен не принимается вместо access.
  3. X-Real-IP от внешнего клиента не подменяет адрес.
  4. spa_fallback не отдаёт файлы вне сборки фронтенда.
  5. Подпись приватных файлов истекает; бессрочная старая — не принимается.
  6. Заказчик не может отменить заказ «в работе» и забрать эскроу;
     двойное назначение не замораживает бюджет дважды; нельзя назначить себя.
  7. Отзыв спора заказчиком возвращает заказ в работу без возврата денег;
     два одновременных решения арбитра выплачивают один раз.
  8. Отклики: чужие отклики и email не видны, повторный отклик отклоняется.
  9. Сброс пароля отзывает refresh-токены, токен сброса хранится хэшем.
 10. Повторное рассмотрение заявки на верификацию отклоняется.

Запуск:
    python tests/security/check_audit_fixes.py
"""
import os
import sys
import tempfile
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from _helpers import isolate_env  # noqa: E402

ADMIN_EMAIL = "arbiter.audit@delo-test.ru"

# Сборка фронтенда-«пустышка»: без index.html маршрут spa_fallback не
# регистрируется, а проверять нужно именно его.
_DIST = tempfile.mkdtemp(prefix="delo_dist_")
os.makedirs(os.path.join(_DIST, "assets"), exist_ok=True)
with open(os.path.join(_DIST, "index.html"), "w", encoding="utf-8") as fh:
    fh.write("<!doctype html><title>SPA</title>")
with open(os.path.join(_DIST, "manifest.json"), "w", encoding="utf-8") as fh:
    fh.write("{}")

isolate_env(
    "check_audit_fixes",
    YOOMONEY_ACCESS_TOKEN="test-token",
    YOOMONEY_NOTIFICATION_SECRET="test-notification-secret",
    ADMIN_EMAILS=ADMIN_EMAIL,
    DIST_DIR=_DIST,
)

_ROOT = os.path.dirname(os.path.dirname(_HERE))
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


client = TestClient(app)
_seq = [0]


def _create_admin_account(email, password):
    """Аккаунт модератора — так же, как на сервере (scripts/admin_access.sh).

    С сайта адрес из ADMIN_EMAILS не регистрируется: почта там не
    подтверждается, и права получил бы тот, кто первым занял адрес
    (см. tests/security/check_admin_access.py).
    """
    import create_admin
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        create_admin.set_account(db, email, password)
    finally:
        db.close()


def register(tag, email=None, password="AuditFix1"):
    _seq[0] += 1
    email = email or f"audit.{tag}.{_seq[0]}.{int(time.time() * 1000)}@delo-test.ru"
    if email == ADMIN_EMAIL:
        _create_admin_account(email, password)
    else:
        r = client.post("/register/", json={"email": email, "password": password, "name": f"U {tag}", "accept_terms": True, "pd_consent": True})
        assert r.status_code in (200, 201), r.text[:200]
    r = client.post("/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    return {
        "id": None, "email": email, "password": password,
        "access": body["access_token"], "refresh": body["refresh_token"],
    }


def hdr(u):
    return {"Authorization": f"Bearer {u['access']}"}


def me(u):
    r = client.get("/users/me", headers=hdr(u))
    assert r.status_code == 200, r.text[:200]
    u["id"] = r.json()["id"]
    return r.json()


def balance(u):
    return me(u)["balance"]


def make_specialist(u):
    r = client.post("/users/me/switch-role", headers=hdr(u))
    assert r.status_code == 200, r.text[:200]
    u["access"] = r.json()["token"]
    me(u)


def deposit(u, amount):
    r = client.post("/wallet/deposit", json={"amount": amount}, headers=hdr(u))
    assert r.status_code == 200, r.text[:200]


def parallel(n, fn):
    results = [None] * n
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        results[i] = fn()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def new_task(customer, budget):
    r = client.post("/tasks/", json={"title": f"Audit task {time.time()}",
                                     "description": "Проверка", "budget": budget,
                                     "is_remote": True}, headers=hdr(customer))
    assert r.status_code == 200, r.text[:200]
    return r.json()["task_id"]


def assign(customer, task_id, spec):
    return client.put(f"/tasks/{task_id}/assign", params={"specialist_id": spec["id"]},
                      headers=hdr(customer))


def main():
    from app.core.database import SessionLocal
    from app.integrations import yoomoney as ym
    from app.models import PaymentRecord, PasswordResetToken, VerificationRequest, VerificationStatus

    # ------------------------------------------------------------------ 1
    print("\n1. Платежи: одно зачисление на один платёж")
    ym.yoomoney_client.enabled = True
    ym.yoomoney_client.get_account_info = lambda: {"account": "4100111111111111"}
    ym.yoomoney_client.request_payment = lambda amount, label, comment=None: {
        "request_id": label, "status": "success", "amount": amount,
        "payment_url": f"https://yoomoney.ru/quickpay/confirm?label={label}&sum={amount}",
    }

    def slow_paid(label):
        # Ответ провайдера идёт по сети — именно в это окно и влезала гонка.
        time.sleep(0.3)
        return {"status": "succeeded", "paid": True, "amount": None}

    ym.get_payment_status = slow_paid
    ym.verify_webhook = lambda data: True

    payer = register("payer")
    start = balance(payer)
    r = client.post("/payments/create", params={"provider": "yoomoney"},
                    json={"amount": 100}, headers=hdr(payer))
    check("платёж создан", r.status_code == 200, r.text[:120])
    pay = r.json()

    codes = parallel(10, lambda: client.post("/payments/confirm", params={
        "payment_id": pay["payment_id"], "confirmation_url": pay["confirmation_url"],
    }, headers=hdr(payer)).json().get("credited"))
    check("10 одновременных confirm: зачислено ровно одним", codes.count(True) == 1,
          f"credited={codes}")
    check("баланс вырос на 100, а не на 1000", balance(payer) == start + 100,
          f"{start} -> {balance(payer)}")

    r = client.post("/payments/webhook/yoomoney", data={
        "label": pay["payment_id"], "operation_id": "op-1", "amount": "100",
        "currency": "643", "codepro": "false",
    })
    check("вебхук после confirm не зачисляет второй раз",
          r.status_code == 200 and balance(payer) == start + 100,
          f"http={r.status_code} balance={balance(payer)}")

    r = client.post("/payments/create", params={"provider": "yoomoney"},
                    json={"amount": 300}, headers=hdr(payer))
    pay2 = r.json()
    before = balance(payer)
    r = client.post("/payments/webhook/yoomoney", data={
        "label": pay2["payment_id"], "operation_id": "op-2", "amount": "300",
        "currency": "643", "codepro": "true",
    })
    check("уведомление с codepro=true не зачисляется",
          r.status_code == 200 and balance(payer) == before, f"balance={balance(payer)}")
    db = SessionLocal()
    try:
        rec = db.query(PaymentRecord).filter(PaymentRecord.payment_id == pay2["payment_id"]).first()
        check("...и платёж остаётся незачисленным", rec.credited_at is None)
    finally:
        db.close()

    # ------------------------------------------------------------------ 2
    print("\n2. Refresh-токен вместо access")
    r = client.get("/users/me", headers={"Authorization": f"Bearer {payer['refresh']}"})
    check("refresh-токен в Authorization -> 401", r.status_code == 401, f"http={r.status_code}")
    r = client.get("/users/me", headers=hdr(payer))
    check("access-токен по-прежнему работает", r.status_code == 200)

    # ------------------------------------------------------------------ 3
    print("\n3. Подмена адреса через X-Real-IP")
    from app.core.security import client_ip

    class FakeReq:
        def __init__(self, host, headers):
            self.client = type("C", (), {"host": host})()
            self.headers = headers

    check("внешний клиент с X-Real-IP получает свой адрес",
          client_ip(FakeReq("93.184.216.34", {"x-real-ip": "1.2.3.4"})) == "93.184.216.34")
    check("внешний клиент с X-Forwarded-For получает свой адрес",
          client_ip(FakeReq("93.184.216.34", {"x-forwarded-for": "1.2.3.4"})) == "93.184.216.34")
    check("от своего прокси берётся X-Forwarded-For",
          client_ip(FakeReq("172.18.0.5", {"x-forwarded-for": "198.51.100.9"})) == "198.51.100.9")

    # ------------------------------------------------------------------ 4
    print("\n4. spa_fallback не выходит за сборку")
    spa = next(r.endpoint for r in app.routes if getattr(r, "name", "") == "spa_fallback")
    index = os.path.realpath(os.path.join(_DIST, "index.html"))
    for evil in ("/etc/passwd", "../../../../../../etc/passwd", "assets/../../../../etc/hostname"):
        resp = spa(evil)
        check(f"{evil!r} -> index.html", os.path.realpath(resp.path) == index, resp.path)
    resp = spa("manifest.json")
    check("настоящий файл сборки отдаётся", resp.path.endswith("manifest.json"), resp.path)

    # ------------------------------------------------------------------ 5
    print("\n5. Подпись приватных файлов")
    import hashlib
    import hmac
    from app.core.config import settings
    from app.core.security import sign_file_token, verify_file_token

    tok = sign_file_token(42)
    check("свежая подпись принимается", verify_file_token(42, tok))
    check("чужой file_id не подходит", not verify_file_token(43, tok))
    check("истёкшая подпись отклоняется", not verify_file_token(42, sign_file_token(42, ttl_sec=-10)))
    legacy = "f1" + hmac.new(settings.SECRET_KEY.encode(), b"file:42", hashlib.sha256).hexdigest()
    check("бессрочная подпись старого формата отклоняется", not verify_file_token(42, legacy))
    os.environ["FILE_TOKEN_ALLOW_LEGACY"] = "1"
    check("...но принимается с FILE_TOKEN_ALLOW_LEGACY=1", verify_file_token(42, legacy))
    del os.environ["FILE_TOKEN_ALLOW_LEGACY"]

    # ------------------------------------------------------------------ 6
    print("\n6. Отмена и назначение")
    cust = register("cust")
    me(cust)
    deposit(cust, 10000)
    spec = register("spec")
    make_specialist(spec)

    task = new_task(cust, 3000)
    client.post(f"/tasks/{task}/responses", json={"text": "Возьмусь"}, headers=hdr(spec))
    before = balance(cust)
    codes = parallel(5, lambda: assign(cust, task, spec).status_code)
    check("двойное назначение: успешно ровно одно", codes.count(200) == 1, f"codes={codes}")
    check("бюджет заморожен один раз", balance(cust) == before - 3000,
          f"{before} -> {balance(cust)}")

    r = client.post(f"/tasks/{task}/cancel", headers=hdr(cust))
    check("заказчик не может отменить заказ в работе -> 403", r.status_code == 403,
          f"http={r.status_code}")
    check("эскроу не вернулся заказчику", balance(cust) == before - 3000)

    r = client.post(f"/tasks/{task}/cancel", headers=hdr(spec))
    check("исполнитель может отказаться -> 200", r.status_code == 200, r.text[:100])
    check("при отказе исполнителя эскроу вернулся", balance(cust) == before,
          f"balance={balance(cust)}")

    selfie = register("selfie")
    me(selfie)
    deposit(selfie, 1000)
    t_self = new_task(selfie, 500)
    make_specialist(selfie)
    r = client.put(f"/tasks/{t_self}/assign", params={"specialist_id": selfie["id"]},
                   headers=hdr(selfie))
    check("назначить исполнителем себя нельзя", r.status_code == 400, f"http={r.status_code}")

    # ------------------------------------------------------------------ 7
    print("\n7. Споры")
    task = new_task(cust, 2000)
    client.post(f"/tasks/{task}/responses", json={"text": "Сделаю"}, headers=hdr(spec))
    assign(cust, task, spec)
    held = balance(cust)
    r = client.post(f"/tasks/{task}/dispute", json={"reason": "Работа не начата"}, headers=hdr(cust))
    check("заказчик открыл спор", r.status_code == 200, r.text[:100])
    r = client.post(f"/tasks/{task}/cancel", headers=hdr(cust))
    status = client.get(f"/tasks/{task}").json()["status"]
    check("отзыв спора заказчиком возвращает заказ в работу",
          r.status_code == 200 and status == "in_progress", f"http={r.status_code} status={status}")
    check("...без возврата эскроу", balance(cust) == held, f"balance={balance(cust)}")

    r = client.post(f"/tasks/{task}/dispute", json={"reason": "Заказчик не отвечает"}, headers=hdr(spec))
    check("исполнитель открыл спор", r.status_code == 200, r.text[:100])
    dispute_id = r.json().get("dispute_id")

    admin = register("admin", email=ADMIN_EMAIL)
    spec_before = balance(spec)
    codes = parallel(5, lambda: client.post(
        f"/admin/disputes/{dispute_id}/resolve", json={"decision": "pay_specialist"},
        headers=hdr(admin)).status_code)
    check("одновременные решения арбитра: прошло одно", codes.count(200) == 1, f"codes={codes}")
    check("исполнителю выплачено один раз (2000 - 5%)", balance(spec) == spec_before + 1900,
          f"{spec_before} -> {balance(spec)}")
    check("заказчику ничего не вернулось", balance(cust) == held)

    # ------------------------------------------------------------------ 8
    print("\n8. Отклики")
    rival = register("rival")
    make_specialist(rival)
    task = new_task(cust, 1000)
    client.post(f"/tasks/{task}/responses", json={"text": "Я", "proposed_price": 900}, headers=hdr(spec))
    client.post(f"/tasks/{task}/responses", json={"text": "Я дешевле", "proposed_price": 800}, headers=hdr(rival))
    r = client.post(f"/tasks/{task}/responses", json={"text": "Ещё раз"}, headers=hdr(rival))
    check("повторный отклик на тот же заказ -> 400", r.status_code == 400, f"http={r.status_code}")
    seen = client.get(f"/tasks/{task}/responses", headers=hdr(rival)).json()
    check("конкурент видит только свой отклик",
          len(seen) == 1 and seen[0]["specialist_id"] == rival["id"], f"видно {len(seen)}")
    seen = client.get(f"/tasks/{task}/responses", headers=hdr(cust)).json()
    check("автор заказа видит все отклики", len(seen) == 2, f"видно {len(seen)}")
    check("email откликнувшихся не отдаётся", all(not x.get("specialist_email") for x in seen))

    # ------------------------------------------------------------------ 9
    print("\n9. Сброс пароля")
    victim = register("victim")
    r = client.post("/auth/forgot-password", json={"email": victim["email"]})
    link = r.json().get("dev_reset_link", "")
    raw = link.split("token=", 1)[-1]
    check("ссылка сброса выдана (dev)", bool(raw), r.text[:100])
    db = SessionLocal()
    try:
        stored = [t.token for t in db.query(PasswordResetToken).all()]
        check("токен сброса в базе не хранится открытым текстом", raw not in stored)
    finally:
        db.close()
    results = parallel(3, lambda: client.post("/auth/reset-password", json={
        "token": raw, "new_password": "NewPassw0rd!"}).status_code)
    check("одна ссылка сброса срабатывает один раз", results.count(200) == 1, f"codes={results}")
    r = client.post("/refresh", params={"refresh_token": victim["refresh"]})
    check("после сброса старый refresh-токен не работает", r.status_code == 401,
          f"http={r.status_code}")

    # ------------------------------------------------------------------ 10
    print("\n10. Верификация")
    db = SessionLocal()
    try:
        vr = VerificationRequest(user_id=spec["id"], full_name="Тест", status=VerificationStatus.pending)
        db.add(vr)
        db.commit()
        vr_id = vr.id
    finally:
        db.close()
    r = client.post(f"/verification/admin/{vr_id}/review", json={"action": "reject", "reason": "нет"},
                    headers=hdr(admin))
    check("заявка отклонена", r.status_code == 200, r.text[:100])
    r = client.post(f"/verification/admin/{vr_id}/review", json={"action": "approve"}, headers=hdr(admin))
    check("уже рассмотренную заявку повторно одобрить нельзя -> 409", r.status_code == 409,
          f"http={r.status_code}")

    print(f"\nИтого: {_passed} OK, {_failed} FAIL")
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
