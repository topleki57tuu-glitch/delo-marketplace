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

Если рядом лежит demo_password.txt, скрипт обновляет в нём строку пароля:
файл — то место, откуда пароль берут люди и скрипты, и устаревшая строка
в нём выглядит как «пароль правильный, а вход не пускает». Флаг --no-save
отключает эту запись.
"""
import argparse
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.core.security import generate_strong_password, hash_password
from app.models import User, RefreshToken
from app.schemas import _check_password


PASSWORD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_password.txt")

# Аккаунты, у которых в demo_password.txt есть своя строка. Остальные
# демо-аккаунты делят один пароль (строка `password = ...`), поэтому своей
# строки у них нет и заводить её не нужно.
PASSWORD_FILE_KEYS = {"admin@delo.ru": "admin_password"}

# Строка машиночитаемого блока: `ключ = значение`.
_KEY_LINE = re.compile(r"^[a-z_]+ = ")


def update_password_file(email: str, password: str):
    """Пишет новый пароль в demo_password.txt. Возвращает путь или None.

    Файл не создаётся с нуля: на боевом контуре его нет и быть не должно, а
    размножать файлы с паролями рядом с приложением — плохая идея. Обновляем
    только то, что уже существует.
    """
    key = PASSWORD_FILE_KEYS.get(email.strip().lower())
    if not key or not os.path.exists(PASSWORD_FILE):
        return None

    try:
        with open(PASSWORD_FILE, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return None

    replaced = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key} ="):
            lines[i] = f"{key} = {password}"
            replaced = True
            break

    if not replaced:
        # Строки нет — файл правили руками. Вставляем после последней
        # машиночитаемой, чтобы хвост подсказок не разрывал блок.
        last = max((i for i, l in enumerate(lines) if _KEY_LINE.match(l)), default=None)
        lines.insert(0 if last is None else last + 1, f"{key} = {password}")

    try:
        with open(PASSWORD_FILE, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError:
        return None
    return PASSWORD_FILE


def main() -> int:
    parser = argparse.ArgumentParser(description="Сменить пароль аккаунта")
    parser.add_argument("email", help="почта аккаунта")
    parser.add_argument(
        "--password",
        help="новый пароль; без флага генерируется стойкий случайный",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="не обновлять demo_password.txt",
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

        if args.no_save:
            print("demo_password.txt не тронут (--no-save).")
            print("Сохрани пароль в менеджере паролей — второй раз он не покажется.")
        else:
            saved = update_password_file(user.email, password)
            if saved:
                print(f"Обновлён {saved} — там теперь текущий пароль.")
            elif os.path.exists(PASSWORD_FILE):
                print(f"В demo_password.txt нет строки для {user.email} — не записывал.")
                print("Сохрани пароль в менеджере паролей — второй раз он не покажется.")
            else:
                print("demo_password.txt рядом нет — создавать не стал.")
                print("Сохрани пароль в менеджере паролей — второй раз он не покажется.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
