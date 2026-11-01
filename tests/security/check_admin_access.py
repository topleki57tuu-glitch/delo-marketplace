"""
Регресс: вход модератора — почта, пароль и права из ADMIN_EMAILS.

Запуск (из корня репозитория):
    python tests/security/check_admin_access.py

Код возврата: 0 — всё сходится, 1 — расхождение.

Почему этот файл существует
---------------------------
Права модератора даёт ADMIN_EMAILS, а is_admin сравнивал почту без учёта
регистра. Регистрация при этом хранила адрес как ввели и дубли искала с
учётом регистра. Измерено на стенде: рядом с admin@delo.ru регистрация
«Admin@delo.ru» проходила, и новый аккаунт получал очередь выплат с
реквизитами (GET /admin/withdrawals — 200). Почта при регистрации не
подтверждается, поэтому так же занимался и адрес модератора, у которого
аккаунта ещё нет.

Что проверяется
---------------
1. Адреса из ADMIN_EMAILS не регистрируются с сайта ни в каком регистре —
   и ответ тот же, что для занятого адреса;
2. регистрация хранит почту в каноническом виде и ищет дубли без учёта
   регистра, в том числе против старых записей, сохранённых как ввели;
3. вход и сброс пароля находят аккаунт без учёта регистра;
4. «двойник» модератора, оставшийся в базе (Boss@delo.ru рядом с
   boss@delo.ru), прав не получает: /users/me — is_admin false,
   /admin/withdrawals — 403;
5. create_admin.py заводит аккаунт модератора, меняет пароль существующему,
   отзывает его refresh-токены, отклоняет слабый пароль и не-адрес;
6. --check показывает модераторов без аккаунта и двойников;
7. SQL миграции normalize_user_emails приводит одиночные адреса и не трогает
   двойников (иначе уникальный индекс уронил бы миграцию).
"""
import contextlib
import glob
import importlib.util
import io
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

BOSS = "boss@delo.ru"
RESERVED = "second@delo.ru"  # в ADMIN_EMAILS, но аккаунта нет
# Регистр в списке намеренно разный: config приводит его сам.
isolate_env("check_admin_access", ADMIN_EMAILS=f"{BOSS},Second@Delo.ru")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

import main  # noqa: E402
import create_admin  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password, verify_password  # noqa: E402
from app.models import User, UserRole  # noqa: E402

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

# Записи «из прошлого»: до исправления регистрация сохраняла почту как ввели.
IMPOSTOR = "Boss@delo.ru"
LEGACY = "Legacy@Mail.ru"
db = SessionLocal()
db.add_all([
    User(email=IMPOSTOR, hashed_password=hash_password("Impostor123"), role=UserRole.customer, name="Двойник"),
    User(email=LEGACY, hashed_password=hash_password("Legacy12345"), role=UserRole.customer, name="Старый"),
])
db.commit()
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def register(email: str, password: str = "Register123"):
    return client.post("/register/", json={
        "email": email, "password": password, "name": "Тест",
        "accept_terms": True, "pd_consent": True,
    })


def login(email: str, password: str):
    return client.post("/login", data={"username": email, "password": password})


def bearer(resp) -> dict:
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def stored_emails(fragment: str) -> list:
    session = SessionLocal()
    try:
        return sorted(u.email for u in session.query(User).all() if fragment in u.email.lower())
    finally:
        session.close()


def run_script(argv, stdin_text: str = ""):
    """create_admin.main с подменённым stdin; возвращает (код, вывод)."""
    out, err = io.StringIO(), io.StringIO()
    old_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin_text)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = create_admin.main(argv)
    finally:
        sys.stdin = old_stdin
    return code, out.getvalue() + err.getvalue()


print("1. Адреса модераторов с сайта не регистрируются")
taken = register("someone.else@delo.ru")
check("обычный адрес регистрируется", taken.status_code == 200, str(taken.status_code))
duplicate_detail = register("someone.else@delo.ru").json().get("detail")
for email in (BOSS, "BOSS@delo.ru", "Boss@Delo.ru", RESERVED, "SECOND@delo.ru"):
    r = register(email)
    check(f"{email} — 400", r.status_code == 400, str(r.status_code))
    check(f"{email} — ответ как для занятого адреса", r.json().get("detail") == duplicate_detail, str(r.json().get("detail")))
check("аккаунт boss@delo.ru не появился", stored_emails("boss@") == [IMPOSTOR], str(stored_emails("boss@")))

print("2. Регистрация хранит канонический вид и ищет дубли без учёта регистра")
r = register("New.User@Mail.ru")
check("New.User@Mail.ru регистрируется", r.status_code == 200, str(r.status_code))
check("сохранена как new.user@mail.ru", stored_emails("new.user@") == ["new.user@mail.ru"], str(stored_emails("new.user@")))
r = register("NEW.USER@mail.ru")
check("тот же адрес в другом регистре — 400", r.status_code == 400, str(r.status_code))
r = register("legacy@mail.ru")
check("дубль старой записи Legacy@Mail.ru — 400", r.status_code == 400, str(r.status_code))

print("3. Вход без учёта регистра")
r = login("NEW.USER@MAIL.RU", "Register123")
check("NEW.USER@MAIL.RU входит", r.status_code == 200, str(r.status_code))
r = login("legacy@mail.ru", "Legacy12345")
check("старая запись Legacy@Mail.ru входит как legacy@mail.ru", r.status_code == 200, str(r.status_code))
r = login("new.user@mail.ru", "WrongPass123")
check("неверный пароль — 401", r.status_code == 401, str(r.status_code))

print("4. Двойник модератора прав не получает")
r = login(IMPOSTOR, "Impostor123")
check("двойник входит (своим паролем, аккаунта boss@ ещё нет)", r.status_code == 200, str(r.status_code))
impostor_auth = bearer(r) if r.status_code == 200 else {}
me = client.get("/users/me", headers=impostor_auth).json()
check("двойник: is_admin false", me.get("is_admin") is False, str(me.get("is_admin")))
r = client.get("/admin/withdrawals", headers=impostor_auth)
check("двойник: очередь выплат — 403", r.status_code == 403, str(r.status_code))

print("5. create_admin.py: аккаунт модератора")
code, out = run_script(["not-an-email", "--password-stdin"], "BossPass123\n")
check("не-адрес — код 1", code == 1, out.strip())
code, out = run_script([BOSS, "--password-stdin"], "short\n")
check("слабый пароль — код 1", code == 1, out.strip())
check("после отказа аккаунта нет", stored_emails("boss@") == [IMPOSTOR], str(stored_emails("boss@")))

code, out = run_script(["  Boss@DELO.ru ", "--password-stdin"], "BossPass123\n")
check("аккаунт создан — код 0", code == 0, out.strip().splitlines()[0] if out.strip() else "")
check("создан с канонической почтой", stored_emails("boss@") == [IMPOSTOR, BOSS], str(stored_emails("boss@")))
check("вывод предупреждает о двойнике", "двойник Boss@delo.ru" in out, "")
session = SessionLocal()
boss = session.query(User).filter(User.email == BOSS).first()
check("согласия с документами не проставлены скриптом", boss is not None and boss.pd_consent_at is None and boss.terms_accepted_at is None)
session.close()

r = login("Boss@Delo.RU", "BossPass123")
check("модератор входит в любом регистре", r.status_code == 200, str(r.status_code))
boss_login = r.json() if r.status_code == 200 else {}
boss_auth = bearer(r) if r.status_code == 200 else {}
me = client.get("/users/me", headers=boss_auth).json()
check("модератор: is_admin true", me.get("is_admin") is True, str(me.get("is_admin")))
r = client.get("/admin/withdrawals", headers=boss_auth)
check("модератор: очередь выплат — 200", r.status_code == 200, str(r.status_code))
r = login(IMPOSTOR, "Impostor123")
check("вход «Boss@delo.ru» теперь ведёт в аккаунт модератора, пароль двойника не подходит", r.status_code == 401, str(r.status_code))
me = client.get("/users/me", headers=impostor_auth).json()
check("старая сессия двойника по-прежнему без прав", me.get("is_admin") is False, str(me.get("is_admin")))

code, out = run_script([BOSS, "--password-stdin"], "BossPass456\n")
check("смена пароля — код 0", code == 0, out.strip().splitlines()[0] if out.strip() else "")
check("отозвана выданная сессия", "Отозвано сессий: 1" in out, out.strip().splitlines()[0] if out.strip() else "")
check("старый пароль не подходит", login(BOSS, "BossPass123").status_code == 401)
check("новый пароль подходит", login(BOSS, "BossPass456").status_code == 200)
r = client.post("/auth/refresh", json={"refresh_token": boss_login.get("refresh_token", "")})
check("refresh-токен до смены пароля отозван", r.status_code == 401, str(r.status_code))

code, out = run_script([BOSS, "--generate"])
generated = next((line.split("Пароль:", 1)[1].strip() for line in out.splitlines() if "Пароль:" in line), "")
check("--generate печатает пароль один раз", code == 0 and len(generated) >= 16, f"длина {len(generated)}")
check("сгенерированный пароль подходит", bool(generated) and login(BOSS, generated).status_code == 200)

code, out = run_script(["New.User@Mail.ru", "--password-stdin"], "Another123\n")
check("существующему обычному аккаунту пароль меняется", code == 0 and login("new.user@mail.ru", "Another123").status_code == 200, out.strip().splitlines()[0] if out.strip() else "")
check("без права модератора — подсказка про ADMIN_EMAILS", "ADMIN_EMAILS" in out, "")

code, out = run_script([" Boss@DELO.ru ", "--normalize"])
check("--normalize печатает канонический вид", code == 0 and out.strip() == BOSS, out.strip())

print("6. --check")
code, out = run_script(["--check"])
check("--check — код 0", code == 0)
check("модератор с аккаунтом", f"{BOSS} — аккаунт есть" in out, "")
check("модератор без аккаунта", f"{RESERVED} — аккаунта нет" in out, "")
check("двойник показан", "двойник Boss@delo.ru" in out, "")
code, out = run_script(["--check", "--emails", "New.User@Mail.ru"])
check("--emails заменяет список", "new.user@mail.ru — аккаунт есть" in out and BOSS not in out, "")

print("7. SQL миграции normalize_user_emails")
paths = glob.glob(os.path.join(REPO_ROOT, "backend", "migrations", "versions", "*_normalize_user_emails.py"))
check("миграция найдена", len(paths) == 1, str(paths))
if paths:
    spec = importlib.util.spec_from_file_location("normalize_user_emails", paths[0])
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    session = SessionLocal()
    session.add_all([
        User(email="Single@Case.ru", hashed_password="x", role=UserRole.customer),
        User(email="Twin@Pair.ru", hashed_password="x", role=UserRole.customer),
        User(email="TWIN@pair.ru", hashed_password="x", role=UserRole.customer),
    ])
    session.commit()
    session.execute(text(migration.NORMALIZE_SQL))
    session.commit()
    session.close()
    check("одиночный адрес приведён", stored_emails("single@") == ["single@case.ru"], str(stored_emails("single@")))
    check("двойники Twin@/TWIN@ не тронуты", stored_emails("twin@") == ["TWIN@pair.ru", "Twin@Pair.ru"], str(stored_emails("twin@")))
    check("двойник модератора не тронут", stored_emails("boss@") == [IMPOSTOR, BOSS], str(stored_emails("boss@")))
    check("старая запись Legacy@Mail.ru приведена", stored_emails("legacy@") == ["legacy@mail.ru"], str(stored_emails("legacy@")))
    session = SessionLocal()
    legacy = session.query(User).filter(User.email == "legacy@mail.ru").first()
    check("пароль приведённой записи прежний", legacy is not None and verify_password("Legacy12345", legacy.hashed_password))
    session.close()

print()
print(f"Проверок: {passed + failed}, провалено: {failed}")
sys.exit(1 if failed else 0)
