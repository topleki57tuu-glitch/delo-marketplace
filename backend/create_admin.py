#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Аккаунт модератора: почта и пароль для входа в админ-панель.

На сервере запускается через обёртку — она же выдаёт права модератора:
    bash scripts/admin_access.sh

Напрямую (из каталога backend):
    python create_admin.py you@mail.ru               # спросит пароль дважды
    python create_admin.py you@mail.ru --generate    # сгенерирует стойкий
    printf '%s\n' "$PASS" | python create_admin.py you@mail.ru --password-stdin
    python create_admin.py --check                   # кто модератор, есть ли двойники

Что делает:
- заводит аккаунт с этой почтой, если его нет, или меняет пароль
  существующему;
- отзывает выданные сессии и снимает счётчик неудачных входов;
- предупреждает о «двойниках» — аккаунтах с той же почтой в другом регистре.

Права модератора скрипт сам НЕ выдаёт: их даёт только ADMIN_EMAILS в .env
(app/core/security.is_admin). Это делает обёртка — после того как аккаунт
уже заведён, чтобы адрес не оставался свободным ни на минуту.

Почему аккаунт заводится здесь, а не регистрацией на сайте. Почта при
регистрации не подтверждается, и адрес из ADMIN_EMAILS мог занять кто
угодно — вместе с очередью выплат и документами на проверку. Поэтому
регистрация такие адреса больше не принимает.

Пароль не передаётся аргументом: аргументы видны в списке процессов и
остаются в истории команд. Его вводят скрыто или подают на stdin.
"""
import argparse
import getpass
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pydantic import EmailStr, TypeAdapter, ValidationError  # noqa: E402
from sqlalchemy import func  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import (  # noqa: E402
    clear_login_failures, generate_strong_password, hash_password, normalize_email,
)
from app.models import RefreshToken, User, UserRole  # noqa: E402
from app.schemas import _check_password  # noqa: E402

DEFAULT_NAME = "Администратор"

_EMAIL = TypeAdapter(EmailStr)


def parse_email(raw: str):
    """Канонический вид почты или None, если это не адрес."""
    try:
        return normalize_email(_EMAIL.validate_python(normalize_email(raw)))
    except ValidationError:
        return None


def parse_list(raw: str) -> list:
    return [e for e in (normalize_email(x) for x in (raw or "").split(",")) if e]


def _fmt(value) -> str:
    # В базе время без пояса, в UTC (datetime.utcnow) — так и подписываем.
    return value.strftime("%d.%m.%Y %H:%M UTC") if value else "нет"


def describe(user: User) -> str:
    return (
        f"id={user.id}, имя «{user.name or 'без имени'}», "
        f"создан {_fmt(user.created_at)}, последняя активность: {_fmt(user.last_seen)}"
    )


def find_twins(db, email: str) -> list:
    """Аккаунты с той же почтой в другом регистре: Admin@delo.ru рядом с admin@delo.ru."""
    return (
        db.query(User)
        .filter(func.lower(func.trim(User.email)) == email, User.email != email)
        .order_by(User.id)
        .all()
    )


def print_twins(db, email: str) -> None:
    twins = find_twins(db, email)
    for twin in twins:
        print(f"    ! двойник {twin.email} — {describe(twin)}")
    if twins:
        print("      У двойников нет прав модератора. Если такой аккаунт заводили не вы, его")
        print("      зарегистрировали, чтобы получить права модератора до исправления.")


def report(db, emails: list) -> None:
    if not emails:
        print("Модераторов нет: ADMIN_EMAILS пуст.")
        return
    print("Модераторы (ADMIN_EMAILS):")
    for email in emails:
        user = db.query(User).filter(User.email == email).first()
        if user:
            print(f"  {email} — аккаунт есть: {describe(user)}")
        else:
            print(f"  {email} — аккаунта нет, войти с этим адресом нельзя")
        print_twins(db, email)


def read_password(args):
    """Пароль и признак «сгенерирован». None — пароли не совпали."""
    if args.generate:
        return generate_strong_password(), True
    if args.password_stdin or not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\r\n"), False
    first = getpass.getpass("Новый пароль: ")
    second = getpass.getpass("Повторите пароль: ")
    if first != second:
        return None, False
    return first, False


def set_account(db, email: str, password: str, name: str = DEFAULT_NAME):
    """Заводит аккаунт или меняет пароль. Возвращает (user, created, revoked)."""
    user = db.query(User).filter(User.email == email).first()
    created = user is None
    revoked = 0
    if created:
        # Согласия с документами не проставляем: их даёт человек, а не скрипт.
        # Сайт покажет окно с документами при первом входе — как всем.
        user = User(
            email=email,
            hashed_password=hash_password(password),
            role=UserRole.customer,
            name=name,
        )
        db.add(user)
    else:
        user.hashed_password = hash_password(password)
        # Смена пароля гасит выданные сессии: иначе украденный refresh-токен
        # продолжал бы работать свои 7 дней.
        revoked = db.query(RefreshToken).filter(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,  # noqa: E712
        ).update(
            {"revoked": True, "revoked_at": datetime.now(timezone.utc)},
            synchronize_session=False,
        )
    db.commit()
    db.refresh(user)
    # Владелец мог упереться в лимит неудачных входов, пока подбирал пароль.
    clear_login_failures(email)
    return user, created, revoked


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Аккаунт модератора: почта и пароль")
    parser.add_argument("email", nargs="?", help="почта модератора")
    parser.add_argument("--generate", action="store_true", help="сгенерировать стойкий пароль")
    parser.add_argument("--password-stdin", action="store_true", help="прочитать пароль из stdin")
    parser.add_argument("--name", default=DEFAULT_NAME, help="имя для нового аккаунта")
    parser.add_argument("--check", action="store_true", help="только показать модераторов и двойников")
    parser.add_argument("--emails", help="для --check: список почт через запятую вместо ADMIN_EMAILS")
    parser.add_argument("--normalize", action="store_true", help="только проверить почту и напечатать её канонический вид")
    parser.add_argument("--no-rights-note", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.check:
        emails = parse_list(args.emails) if args.emails is not None else list(settings.ADMIN_EMAILS)
        db = SessionLocal()
        try:
            report(db, emails)
        finally:
            db.close()
        return 0

    if not args.email:
        parser.error("укажите почту модератора")
    email = parse_email(args.email)
    if not email:
        print(f"«{args.email.strip()}» — это не адрес почты.", file=sys.stderr)
        return 1
    if args.normalize:
        print(email)
        return 0

    password, generated = read_password(args)
    if password is None:
        print("Пароли не совпадают — ничего не изменено.", file=sys.stderr)
        return 1
    try:
        _check_password(password)
    except ValueError as exc:
        print(f"Пароль не подходит: {exc}. Ничего не изменено.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        user, created, revoked = set_account(db, email, password, args.name)
        if created:
            print(f"Аккаунт создан: {user.email} (id={user.id}).")
        else:
            print(f"Пароль изменён: {user.email} (id={user.id}). Отозвано сессий: {revoked}.")
        if generated:
            print()
            print(f"    Пароль: {password}")
            print()
            print("Сохраните его в менеджере паролей — второй раз он не покажется.")
        print_twins(db, email)
        if not args.no_rights_note and email not in settings.ADMIN_EMAILS:
            print(f"Права модератора даёт ADMIN_EMAILS в .env, а {email} в нём нет.")
            print("Выдать права: bash scripts/admin_access.sh " + email)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
