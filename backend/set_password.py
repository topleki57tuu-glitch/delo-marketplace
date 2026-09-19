#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Смена пароля аккаунта из командной строки.

Запуск (из каталога backend):
    python set_password.py admin@delo.ru                 # сгенерировать стойкий
    python set_password.py admin@delo.ru --password '...' # задать свой

Зачем отдельно от веб-интерфейса. Сменить пароль можно из профиля
(POST /users/me/password) или письмом со сбросом. Но сброс требует рабочего
SMTP: если он не настроен, ссылка не уходит и вернуть себе доступ нечем.
Этот скрипт — путь восстановления, когда войти уже не получается.

Пароль, заданный через --password, попадает в историю команд оболочки.
Для админского аккаунта лучше запускать без флага и сохранить напечатанное
значение в менеджере паролей.
"""
import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.core.security import generate_strong_password, hash_password
from app.models import User, RefreshToken
from app.schemas import _check_password


def main() -> int:
    parser = argparse.ArgumentParser(description="Сменить пароль аккаунта")
    parser.add_argument("email", help="почта аккаунта")
    parser.add_argument(
        "--password",
        help="новый пароль; без флага генерируется стойкий случайный",
    )
    args = parser.parse_args()

    password = args.password or generate_strong_password()
    try:
        _check_password(password)
    except ValueError as exc:
        print(f"Пароль не подходит: {exc}")
        return 1

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == args.email).first()
        if not user:
            print(f"Аккаунт {args.email} не найден.")
            # Подсказываем, если почта просто не в списке существующих
            emails = [u.email for u in db.query(User).order_by(User.id).all()]
            print("Есть такие аккаунты: " + ", ".join(emails[:20]))
            return 1

        user.hashed_password = hash_password(password)

        # Смена пароля гасит выданные сессии: иначе украденный refresh-токен
        # продолжает работать свои 7 дней, и пароль ему не помеха.
        revoked = db.query(RefreshToken).filter(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,
        ).update(
            {"revoked": True, "revoked_at": datetime.now(timezone.utc)},
            synchronize_session=False,
        )
        db.commit()

        print(f"Пароль изменён для {user.email} (id={user.id}).")
        print(f"Отозвано refresh-токенов: {revoked}")
        if not args.password:
            print()
            print(f"    Новый пароль: {password}")
            print()
            print("Сохрани его в менеджере паролей — второй раз он не покажется.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
