#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка примеров кода в документации.

Запуск (из любого каталога):
    python tests/check_docs_code_samples.py

Коды выхода:
    0 — ссылок на несуществующие имена нет;
    1 — есть битые ссылки (документация учит именам, которых нет в коде);
    2 — не удалось загрузить пакет app, результат недостоверен;
    3 — не сработала самопроверка: детектор не ловит заведомо битый пример.

Зачем. Документация здесь уже разошлась с кодом, и разошлась молча. В
docs/FAQ.md рецепт смены пароля импортировал `get_password_hash`, которого нет
(в проекте `hash_password`), писал в колонку `password`, которой нет (она
называется `hashed_password`), и предлагал `from passlib.hash import bcrypt`,
хотя passlib вообще не в зависимостях. Рецепт добавления эндпоинта
импортировал `get_current_user`, которого в проекте никогда не было. Отдельно
в разделе про лимиты стоял совет выключить защиту правкой
`app/core/config.py` — файла, который эти значения больше не задаёт, — и
настройка `TRUSTED_PROXIES`, которой нет ни в одном файле.

Такой пример хуже отсутствующего: он выглядит рабочим, падает у читателя и
учит неверному.

Почему здесь самопроверка. Первая версия этого скрипта не добавляла каталог
backend в sys.path, поэтому НИ ОДИН модуль app не импортировался, все они
попали в категорию «рецепт предлагает создать», и проверка бодро печатала
«битых ссылок 0». Ноль был получен по неверной причине — то есть проверка не
проверяла ничего. Поэтому теперь она обязана поймать заведомо битый пример,
иначе сама объявляется сломанной.

Что НЕ проверяется:
  * модули, которые рецепт сам предлагает создать (app.tasks.email и т.п.) —
    они считаются отдельной категорией и печатаются, но не валят проверку;
  * блоки, смешивающие Python и shell, — это стиль остальной документации;
  * корректность логики и актуальность значений по умолчанию.
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

# Живая документация. Отчёты в корне (report_*.md) — снимки прошлых сессий,
# они описывают состояние на свой коммит и намеренно не проверяются.
DOCS = [ROOT / "README.md"] + sorted((ROOT / "docs").glob("*.md"))

CODE_BLOCK = re.compile(r"```python\n(.*?)```", re.S)

# Заведомо битый пример: такого имени в app.core.security нет и не было.
# Если детектор его не находит, проверять документацию бессмысленно.
SELF_TEST_SAMPLE = "from app.core.security import get_password_hash\n"


def scan(code: str):
    """Разбирает один блок. Возвращает (битые ссылки, модули на создание, синтаксис)."""
    broken, to_create, syntax = [], [], []
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return broken, to_create, [(exc.msg, exc.lineno)]

    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        if not node.module or not node.module.startswith("app."):
            continue
        try:
            module = __import__(node.module, fromlist=["*"])
        except ModuleNotFoundError:
            to_create.append(node.module)
            continue
        for alias in node.names:
            if not hasattr(module, alias.name):
                broken.append((node.module, alias.name))
    return broken, to_create, syntax


def self_test() -> bool:
    broken, _, _ = scan(SELF_TEST_SAMPLE)
    return any(name == "get_password_hash" for _, name in broken)


# Модули, которые документация импортирует чаще всего. Если хоть один не
# загружается, различать «имени нет» и «модуль не импортировался» невозможно,
# и проверка обязана честно сказать, что не работает, а не напечатать ноль.
PREFLIGHT = [
    "app.core.security",
    "app.core.csrf",
    "app.core.database",
    "app.models",
    "app.schemas",
]


def preflight_failures():
    failures = []
    for module in PREFLIGHT:
        try:
            __import__(module, fromlist=["*"])
        except Exception as exc:
            failures.append((module, f"{type(exc).__name__}: {exc}"))
    return failures


def main() -> int:
    # Без этого импорт app не сработает при запуске не из backend/, и проверка
    # выродится в «все модули предлагается создать» (см. историю в docstring).
    sys.path.insert(0, str(BACKEND))

    failures = preflight_failures()
    if failures:
        print("НЕ МОГУ загрузить модули приложения, результат недостоверен:")
        for module, exc in failures:
            print(f"  {module}: {exc}")
        print("Проверка не выполнена. Обычно это значит, что не установлены")
        print("зависимости: pip install -r backend/requirements.txt")
        return 2

    if not self_test():
        print("САМОПРОВЕРКА НЕ ПРОШЛА: детектор не видит заведомо битый пример")
        print(f"  образец: {SELF_TEST_SAMPLE.strip()}")
        print("Считайте проверку сломанной, а не документацию чистой.")
        return 3
    print("самопроверка: детектор ловит заведомо битую ссылку\n")

    total_broken = 0
    total_create = 0
    for path in DOCS:
        if not path.exists():
            print(f"нет файла: {path}")
            continue
        text = path.read_text(encoding="utf-8")
        blocks = CODE_BLOCK.findall(text)
        broken, to_create, syntax = [], [], []
        for number, code in enumerate(blocks, 1):
            b, c, s = scan(code)
            broken.extend((number,) + row for row in b)
            to_create.extend((number, module) for module in c)
            syntax.extend((number,) + row for row in s)

        print(f"{path.relative_to(ROOT)}: блоков {len(blocks)}, битых ссылок {len(broken)}")
        for number, module, name in broken:
            print(f"  БЛОК {number}: {module} не содержит {name}")
        for number, module in to_create:
            print(f"  (блок {number}: {module} — модуль предлагается создать)")
        for number, msg, line in syntax:
            print(f"  (блок {number}, строка {line}: {msg} — блок смешивает Python и shell)")
        total_broken += len(broken)
        total_create += len(to_create)

    print()
    print(f"модулей «на создание»: {total_create} "
          f"(если это все импорты подряд — проверка опять не работает)")
    if total_broken:
        print(f"ИТОГ: битых ссылок {total_broken}. "
              f"Документация учит именам, которых нет в коде.")
        return 1
    print("ИТОГ: ссылок на несуществующие имена нет")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
