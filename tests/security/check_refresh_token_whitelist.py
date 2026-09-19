#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка того, что refresh-токен принимается только по записи в базе.

Запуск (бэкенд поднят):
    python tests/security/check_refresh_token_whitelist.py

Что именно доказываем. Раньше проверка искала строку с ``revoked == True`` —
то есть отсутствие строки считалось признаком живого токена. Из-за этого
удаление записи не отзывало токен, а воскрешало отозванный: JWT самодостаточен,
и подпись с ``exp`` оставались единственной защитой.

Замер до фикса (аккаунт A удалён вместе со своими токенами, затем создан B,
которому достался тот же id):

    5. refresh токеном A: HTTP 200
    6. access-токен открывает /users/me: HTTP 200, email=tmp_idreuse_b@delo.ru

То есть refresh-токен удалённого пользователя выдал сессию новому владельцу
того же id. Проверка ниже фиксирует, что так больше не происходит.

Скрипт лезет в базу напрямую: отозвать или удалить строку токена через API
нельзя, а именно эти два способа и надо различить.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
# Скрипт лежит в tests/security, корень репозитория — на два уровня выше.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

A_EMAIL = "tmp_whitelist_a@delo.ru"
A_PASSWORD = "TempWhitelist1"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'OK  ' if ok else 'ПРОВАЛ'}] {name}" + (f" — {detail}" if detail else ""))


def refresh(token):
    url = BASE + "/refresh?" + urllib.parse.urlencode({"refresh_token": token})
    req = urllib.request.Request(url, data=b"", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def me(access_token):
    req = urllib.request.Request(
        BASE + "/users/me", headers={"Authorization": f"Bearer {access_token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def login(email, password):
    data = urllib.parse.urlencode({"username": email, "password": password}).encode()
    req = urllib.request.Request(
        BASE + "/login",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def main() -> int:
    # Проверка обязана честно сказать «не смогла», а не «всё чисто»: без
    # поднятого бэкенда или без зависимостей все запросы упадут, и молчаливый
    # ноль провалов читался бы как успех.
    try:
        from app.core.database import SessionLocal
        from app.core.security import hash_password
        from app.models import RefreshToken, User, UserRole
    except Exception as exc:  # noqa: BLE001 — нужен любой сбой импорта
        print(f"НЕ ЗАПУСТИЛАСЬ: не удалось импортировать приложение: {exc}")
        print("Запусти из корня репозитория интерпретатором с зависимостями проекта.")
        return 2

    try:
        # Заголовок обязан быть ASCII: кириллица в нём роняет urllib ещё до
        # запроса, и «недоступен» выглядело бы как «бэкенд лежит».
        status, _ = me("junk")
        if status not in (401, 403):
            print(f"НЕ ЗАПУСТИЛАСЬ: бэкенд на {BASE} отвечает неожиданно ({status})")
            return 2
    except Exception as exc:  # noqa: BLE001
        print(f"НЕ ЗАПУСТИЛАСЬ: бэкенд на {BASE} недоступен: {exc}")
        return 2

    db = SessionLocal()

    def purge():
        user = db.query(User).filter(User.email == A_EMAIL).first()
        if user:
            db.query(RefreshToken).filter(RefreshToken.user_id == user.id).delete()
            db.delete(user)
            db.commit()

    try:
        purge()

        user = User(
            email=A_EMAIL,
            hashed_password=hash_password(A_PASSWORD),
            name="Temp Whitelist",
            role=UserRole.customer,
        )
        db.add(user)
        db.commit()
        user_id = user.id
        print(f"временный аккаунт: id={user_id}")

        status, body = login(A_EMAIL, A_PASSWORD)
        if status != 200:
            print(f"НЕ ЗАПУСТИЛАСЬ: логин не прошёл: {status} {body}")
            return 2
        token = body["refresh_token"]

        row = db.query(RefreshToken).filter(RefreshToken.user_id == user_id).first()
        jti = row.token
        # Запоминаем сразу: после удаления строки обращение к её полям упадёт.
        expires_at = row.expires_at
        print(f"строка токена в базе: jti={jti[:8]}...")
        print()

        # 1. Живая строка — токен работает.
        status, body = refresh(token)
        ok = status == 200
        if ok:
            me_status, me_body = me(body["access_token"])
            ok = me_status == 200 and me_body.get("email") == A_EMAIL
        record("живой токен принимается и открывает свой аккаунт", ok, f"HTTP {status}")

        # 2. Отзыв через UPDATE (так делают logout и смена пароля) — 401.
        db.query(RefreshToken).filter(RefreshToken.token == jti).update(
            {"revoked": True}, synchronize_session=False
        )
        db.commit()
        status, _ = refresh(token)
        record("отозванная строка (UPDATE revoked) блокирует токен", status == 401, f"HTTP {status}")

        # 3. Строки нет вовсе — 401. Это и есть исправление: до него удаление
        #    записи делало токен снова рабочим.
        db.query(RefreshToken).filter(RefreshToken.token == jti).delete()
        db.commit()
        # Снимаем объект удалённой строки с сессии: SQLite переиспользует id,
        # и вставка новой строки с тем же первичным ключом иначе даёт
        # предупреждение про identity map — шум в выводе CI.
        db.expunge_all()
        status, _ = refresh(token)
        record(
            "удалённая строка блокирует токен (до фикса здесь было 200)",
            status == 401,
            f"HTTP {status}",
        )

        # 4. Строка есть, но указывает на другого пользователя — 401.
        other = db.query(User).filter(User.id != user_id).first()
        db.add(
            RefreshToken(
                user_id=other.id,
                token=jti,
                expires_at=expires_at,
                revoked=False,
            )
        )
        db.commit()
        status, _ = refresh(token)
        record(
            "строка, приписанная другому аккаунту, токен не пропускает",
            status == 401,
            f"HTTP {status}",
        )

        # 5. Аккаунт удалён целиком — 401.
        db.query(RefreshToken).filter(RefreshToken.token == jti).delete()
        db.delete(db.query(User).filter(User.id == user_id).first())
        db.commit()
        status, _ = refresh(token)
        record("удалённый аккаунт: refresh не выдаёт сессию", status == 401, f"HTTP {status}")
    finally:
        # Убираем за собой: временный аккаунт не должен пережить проверку.
        purge()
        db.close()

    print()
    print("=" * 68)
    print("Итог")
    print("=" * 68)
    failed = [name for name, ok, _ in results if not ok]
    print(f"Проверок: {len(results)}, провалено: {len(failed)}")
    for name in failed:
        print(f"  ПРОВАЛ: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
