"""
Регресс: подтверждение почты.

Запуск (из корня репозитория):
    python tests/security/check_email_verification.py

Код возврата: 0 — всё как задумано, 1 — расхождение.

Почему этот файл существует
---------------------------
Раньше регистрация принимала любой адрес и ничем его не проверяла. По почте
восстанавливается пароль, поэтому вывод денег должен быть у владельца ящика,
а не у того, кто первым вписал чужой адрес. Теперь после регистрации уходит
письмо со ссылкой, а вывод денег требует подтверждённой почты — но только
когда на сервере настроена отправка писем: без неё подтвердить почту нельзя,
и требование закрыло бы вывод всем.

Что проверяется
---------------
1. Без почты на сервере (стенд разработчика): регистрация отдаёт
   dev_verify_link, вывод не требует подтверждения, ссылка подтверждает почту,
   повторное подтверждение — не ошибка.
2. Токен: мусор, истёкший, чужого типа, для другого адреса и для
   несуществующего аккаунта — 400; токен из письма НЕ работает как вход.
3. С почтой на сервере: письмо уходит после регистрации, вывод без
   подтверждения — 403 и деньги не двигаются; «Отправить письмо ещё раз»
   шлёт новую ссылку, после подтверждения вывод проходит.
4. EMAIL_VERIFICATION_REQUIRED=0 выключает требование.
5. Сбой почты: регистрация всё равно проходит, повторная отправка — 502;
   боевой сервер без почты — 503 и без ссылки в ответе.
6. Не чаще трёх писем в час на аккаунт.
7. Порт 465 — шифрованное соединение сразу (SMTP_SSL); проверка почты
   с сервера (`python -m app.core.email --test`) объясняет ошибку.
8. docker-compose.prod.yml передаёт настройки почты и
   EMAIL_VERIFICATION_REQUIRED backend, воркеру и планировщику: без этого
   строка в .env до контейнера не доходит.
"""
import io
import os
import smtplib
import sys
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

isolate_env("check_email_verification")
SMTP_VARS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "EMAIL_VERIFICATION_REQUIRED")
for name in SMTP_VARS:
    os.environ.pop(name, None)

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core import email as email_module  # noqa: E402
from app.core import email_verification  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import User  # noqa: E402

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
client = TestClient(main.app, raise_server_exceptions=False)
PASSWORD = "Password123"

sent = []  # письма, которые «ушли»: (кому, тема, текст)
smtp_error = None  # чем «падает» почтовый сервер, если задано


def fake_send(to, subject, body):
    if not email_module.email_configured():
        raise email_module.EmailNotConfigured("SMTP not configured")
    if smtp_error is not None:
        raise smtp_error
    sent.append((to, subject, body))


email_verification.send_email_sync = fake_send


def smtp_on():
    os.environ.update({"SMTP_HOST": "smtp.example.ru", "SMTP_USER": "robot@example.ru", "SMTP_PASS": "secret"})


def smtp_off():
    for name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS"):
        os.environ.pop(name, None)


def register(email: str) -> dict:
    r = client.post("/register/", json={
        "email": email, "password": PASSWORD, "name": "Тест",
        "accept_terms": True, "pd_consent": True,
    })
    assert r.status_code == 200, f"регистрация {email}: {r.status_code} {r.text}"
    return r.json()


def user_by_email(email: str) -> User:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.email == email).first()
    finally:
        db.close()


def auth(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user_by_email(email).id)})}"}


def set_balance(email: str, amount: int) -> None:
    db = SessionLocal()
    try:
        db.query(User).filter(User.email == email).update({"balance": amount})
        db.commit()
    finally:
        db.close()


def balance(email: str) -> int:
    return user_by_email(email).balance or 0


def me(email: str) -> dict:
    return client.get("/users/me", headers=auth(email)).json()


def token_from_link(link: str) -> str:
    return parse_qs(urlparse(link).query)["token"][0]


def token_from_body(body: str) -> str:
    line = next(part for part in body.split() if "/verify-email?token=" in part)
    return token_from_link(line)


def withdraw(email: str, amount: int = 500):
    return client.post("/wallet/withdraw", headers=auth(email),
                       json={"amount": amount, "method": "card", "requisites": "4111111111111111"})


def verify(token: str):
    return client.post("/auth/verify-email", json={"token": token})


# ---------------------------------------------------------------------------
print("\n1. Стенд разработчика без почты")
smtp_off()
data = register("dev@verify.ru")
link = data.get("dev_verify_link") or ""
check("регистрация отдаёт dev_verify_link", link.startswith("http://localhost:5173/verify-email?token="), link[:60])
check("письмо не отправлялось", data.get("verification_email_sent") is False and not sent)
profile = me("dev@verify.ru")
check("профиль: почта не подтверждена", profile.get("email_verified") is False)
check("профиль: подтвердить можно (стенд)", profile.get("email_verification_available") is True)
check("профиль: вывод не требует подтверждения без почты", profile.get("email_verification_required") is False)
set_balance("dev@verify.ru", 2000)
r = withdraw("dev@verify.ru")
check("вывод без почты на сервере не блокируется", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

r = verify(token_from_link(link))
check("ссылка подтверждает почту", r.status_code == 200 and r.json().get("already_verified") is False, r.text[:120])
check("в базе стоит дата подтверждения", user_by_email("dev@verify.ru").email_verified_at is not None)
check("профиль: почта подтверждена", me("dev@verify.ru").get("email_verified") is True)
r = verify(token_from_link(link))
check("повторное подтверждение — не ошибка", r.status_code == 200 and r.json().get("already_verified") is True, r.text[:120])

# ---------------------------------------------------------------------------
print("\n2. Проверка токена")
register("token@verify.ru")
target = user_by_email("token@verify.ru")
now = datetime.now(timezone.utc)


def forge(**overrides) -> str:
    payload = {"sub": str(target.id), "email": target.email, "type": "email_verify",
               "iat": now, "exp": now + timedelta(days=3)}
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


r = verify("мусор")
check("мусор — 400", r.status_code == 400, r.text[:100])
r = verify(forge(exp=now - timedelta(minutes=1)))
check("истёкшая ссылка — 400 и «устарела»", r.status_code == 400 and "устарела" in r.text, r.text[:120])
r = verify(create_access_token({"sub": str(target.id)}))
check("access-токен не подтверждает почту", r.status_code == 400, r.text[:100])
r = verify(forge(email="other@verify.ru"))
check("ссылка на другой адрес — 400", r.status_code == 400, r.text[:100])
r = verify(forge(sub="999999"))
check("ссылка на несуществующий аккаунт — 400", r.status_code == 400, r.text[:100])
r = verify(jwt.encode({"sub": str(target.id), "email": target.email, "type": "email_verify",
                       "exp": now + timedelta(days=3)}, "чужой-ключ-" + "x" * 40, algorithm="HS256"))
check("подпись чужим ключом — 400", r.status_code == 400, r.text[:100])
check("после всех попыток почта не подтверждена", user_by_email("token@verify.ru").email_verified_at is None)
r = client.get("/users/me", headers={"Authorization": f"Bearer {forge()}"})
check("токен из письма не работает как вход", r.status_code == 401, f"{r.status_code}")

# ---------------------------------------------------------------------------
print("\n3. Почта настроена на сервере")
smtp_on()
sent.clear()
data = register("spec@verify.ru")
check("регистрация: письмо отправлено", data.get("verification_email_sent") is True and len(sent) == 1,
      f"писем: {len(sent)}")
check("регистрация: ссылки в ответе нет", "dev_verify_link" not in data)
first_link_token = token_from_body(sent[0][2]) if sent else ""
check("письмо ушло на адрес аккаунта", bool(sent) and sent[0][0] == "spec@verify.ru")
profile = me("spec@verify.ru")
check("профиль: вывод требует подтверждения", profile.get("email_verification_required") is True)

set_balance("spec@verify.ru", 3000)
r = withdraw("spec@verify.ru")
check("вывод без подтверждения — 403", r.status_code == 403, f"{r.status_code}")
check("в отказе понятный текст", "Подтвердите почту" in r.text, r.text[:120])
check("деньги не двинулись", balance("spec@verify.ru") == 3000, f"баланс={balance('spec@verify.ru')}")

sent.clear()
r = client.post("/auth/resend-verification", headers=auth("spec@verify.ru"))
check("«отправить ещё раз» — 200 и письмо", r.status_code == 200 and len(sent) == 1, f"{r.status_code} {r.text[:100]}")
check("при настроенной почте ссылка в ответ не попадает", "dev_verify_link" not in r.json())
r = verify(token_from_body(sent[0][2]) if sent else "")
check("ссылка из повторного письма подтверждает", r.status_code == 200, r.text[:100])
r = verify(first_link_token)
check("ссылка из первого письма тоже действует", r.status_code == 200 and r.json().get("already_verified") is True)
r = withdraw("spec@verify.ru")
check("после подтверждения вывод проходит", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
check("сумма ушла в заявку", balance("spec@verify.ru") == 2500, f"баланс={balance('spec@verify.ru')}")

sent.clear()
r = client.post("/auth/resend-verification", headers=auth("spec@verify.ru"))
check("подтверждённому письмо не шлём", r.status_code == 200 and r.json().get("already_verified") is True and not sent)

# ---------------------------------------------------------------------------
print("\n4. EMAIL_VERIFICATION_REQUIRED=0")
register("off@verify.ru")
set_balance("off@verify.ru", 1000)
os.environ["EMAIL_VERIFICATION_REQUIRED"] = "0"
r = withdraw("off@verify.ru")
check("требование выключено — вывод проходит", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
check("профиль: вывод не требует подтверждения", me("off@verify.ru").get("email_verification_required") is False)
os.environ.pop("EMAIL_VERIFICATION_REQUIRED")

# ---------------------------------------------------------------------------
print("\n5. Сбой почты")
smtp_error = smtplib.SMTPServerDisconnected("сервер оборвал соединение")
data = register("broken@verify.ru")
check("сбой письма не ломает регистрацию", data.get("user_id") is not None)
r = client.post("/auth/resend-verification", headers=auth("broken@verify.ru"))
check("повторная отправка при сбое — 502", r.status_code == 502, f"{r.status_code} {r.text[:100]}")
smtp_error = None

smtp_off()
settings.IS_PRODUCTION = True
try:
    r = client.post("/auth/resend-verification", headers=auth("broken@verify.ru"))
    check("боевой сервер без почты — 503", r.status_code == 503, f"{r.status_code} {r.text[:100]}")
    check("…и без ссылки в ответе", "dev_verify_link" not in r.text)
    check("профиль: полоску не показываем", me("broken@verify.ru").get("email_verification_available") is False)
finally:
    settings.IS_PRODUCTION = False

# ---------------------------------------------------------------------------
print("\n6. Не чаще трёх писем в час")
smtp_on()
register("limit@verify.ru")
sent.clear()
settings.RATE_LIMIT_ENABLED = True
try:
    codes = [client.post("/auth/resend-verification", headers=auth("limit@verify.ru")).status_code for _ in range(4)]
finally:
    settings.RATE_LIMIT_ENABLED = False
check("три письма проходят, четвёртое — 429", codes == [200, 200, 200, 429], str(codes))
check("ушло ровно три письма", len(sent) == 3, f"писем: {len(sent)}")

# ---------------------------------------------------------------------------
print("\n7. Транспорт и проверка почты с сервера")
calls = []


class FakeSMTP:
    def __init__(self, host, port, timeout=None):
        calls.append(("plain", host, port))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        calls.append(("starttls",))

    def login(self, user, password):
        if password == "wrong":
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")
        calls.append(("login", user))

    def send_message(self, msg):
        calls.append(("send", msg["To"]))


class FakeSMTPSSL(FakeSMTP):
    def __init__(self, host, port, timeout=None):
        calls.append(("ssl", host, port))


real_smtp, real_ssl = email_module.smtplib.SMTP, email_module.smtplib.SMTP_SSL
email_module.smtplib.SMTP, email_module.smtplib.SMTP_SSL = FakeSMTP, FakeSMTPSSL
try:
    os.environ["SMTP_PORT"] = "465"
    email_module.send_email_sync("a@verify.ru", "тема", "текст")
    check("порт 465 — SMTP_SSL без STARTTLS", calls[0] == ("ssl", "smtp.example.ru", 465) and ("starttls",) not in calls, str(calls))
    calls.clear()
    os.environ["SMTP_PORT"] = "587"
    email_module.send_email_sync("a@verify.ru", "тема", "текст")
    check("порт 587 — STARTTLS", calls[:2] == [("plain", "smtp.example.ru", 587), ("starttls",)], str(calls))

    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = email_module.main(["--test", "owner@verify.ru"])
    check("проверка почты: письмо ушло — код 0", code == 0 and "отправлено" in out.getvalue(), out.getvalue()[-120:])
    check("проверка почты не печатает пароль", "secret" not in out.getvalue() + err.getvalue())

    os.environ["SMTP_PASS"] = "wrong"
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = email_module.main(["--test", "owner@verify.ru"])
    check("неверный пароль — код 1 и подсказка", code == 1 and "пароль" in err.getvalue() and "приложения" in err.getvalue(),
          err.getvalue()[-160:].replace("\n", " "))
    smtp_off()
    out = io.StringIO()
    with redirect_stdout(out):
        code = email_module.main(["--test", "owner@verify.ru"])
    check("почта не настроена — код 2", code == 2 and "не настроена" in out.getvalue())
finally:
    email_module.smtplib.SMTP, email_module.smtplib.SMTP_SSL = real_smtp, real_ssl
    os.environ.pop("SMTP_PORT", None)

print("\n8. docker-compose.prod.yml")
import yaml  # noqa: E402

with open(os.path.join(REPO_ROOT, "docker-compose.prod.yml"), encoding="utf-8") as fh:
    compose = yaml.safe_load(fh)
for service in ("backend", "worker", "beat"):
    env = compose["services"][service].get("environment") or {}
    missing = [name for name in SMTP_VARS if name not in env]
    check(f"{service}: настройки почты передаются", not missing, "нет: " + ", ".join(missing) if missing else "")

print(f"\nИтог: {passed} OK, {failed} FAIL")
sys.exit(1 if failed else 0)
