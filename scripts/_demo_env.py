# -*- coding: utf-8 -*-
"""
Общий резолвер демо-пароля для вспомогательных скриптов.

Пароль больше не хранится в репозитории: seed_demo.py либо берёт его из
переменной окружения DEMO_PASSWORD, либо генерирует случайный и складывает
в backend/demo_password.txt (файл в .gitignore).

Порядок поиска:
  1. os.environ["DEMO_PASSWORD"]
  2. backend/demo_password.txt  (строка вида "Админ: admin@delo.ru / <пароль>")

Если не найдено — процесс завершается с понятной инструкцией.
"""
import os
import sys

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3000")
API_BASE = os.environ.get("API_BASE", "http://localhost:8000")

_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")


def _parse_password_file(path):
    """Достаёт пароль из demo_password.txt (строка "password = <значение>").

    Фолбэк — старая человекочитаемая форма "Пароль для всех ...: <значение>".
    """
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        lines = [ln.strip() for ln in fh]
    for line in lines:
        if line.startswith("password") and "=" in line:
            candidate = line.split("=", 1)[1].strip()
            if candidate:
                return candidate
    for line in lines:
        if line.lower().startswith("пароль") and ":" in line:
            candidate = line.split(":", 1)[1].strip()
            if candidate:
                return candidate
    return None


def get_demo_password(required=True):
    pwd = os.environ.get("DEMO_PASSWORD")
    if pwd:
        return pwd
    pwd = _parse_password_file(os.path.join(_BACKEND, "demo_password.txt"))
    if pwd:
        return pwd
    if required:
        sys.exit(
            "DEMO_PASSWORD не задан и backend/demo_password.txt не найден.\n"
            "Запусти `python backend/seed_demo.py` или задай DEMO_PASSWORD в окружении."
        )
    return None


DEMO_PASSWORD = get_demo_password()
