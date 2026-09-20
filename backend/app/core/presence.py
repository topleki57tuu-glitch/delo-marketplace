# -*- coding: utf-8 -*-
"""Признак «пользователь сейчас онлайн».

Почему отдельный модуль. Функция существовала в ДВУХ копиях —
`app/api/users.py` и `app/api/responses.py`, — и обе возвращали False всегда.
Дефект был невидим, потому что каждая оборачивала расчёт в
`except Exception: return False`, а исключение возникало на каждом вызове:

  * в `users.py` сравнивались naive и aware datetime —
    `datetime.now(timezone.utc) - user.last_seen`, где `User.last_seen` это
    `Column(DateTime)` без таймзоны:
    `TypeError: can't subtract offset-naive and offset-aware datetimes`;
  * в `responses.py` строка разбиралась как строка —
    `datetime.fromisoformat(user.last_seen)` по объекту datetime:
    `TypeError: fromisoformat: argument must be str`.

Замер на живом стенде: у пользователя `last_seen` отстоял на 91 секунду
(внутри окна в 120 с), SQL-подсчёт в админ-панели показывал 4 онлайн-человека,
а обе функции отвечали False. То есть `online` в `GET /users/me`,
`GET /specialists/` и `specialist_online` в списке откликов были мертвы, а
бейдж «Онлайн» на странице специалистов не отрисовывался никогда.

Эталон, который работал всё это время, — `app/api/admin.py`: он считает онлайн
SQL-условием `User.last_seen >= now - timedelta(seconds=120)` по naive `now`
из `datetime.utcnow()`. Здесь тот же смысл, но для одного объекта в памяти.

Про таймзоны. Колонка naive, и `datetime.utcnow()` тоже naive — сравнивать их
корректно. Переводить колонку в timezone-aware нельзя без миграции, а
`datetime.now(timezone.utc)` здесь дал бы ровно тот TypeError, который и
сломал обе прежние копии. Если колонку когда-нибудь переведут на aware,
это место обязано поменяться вместе с ней.
"""
from datetime import datetime, timezone
from typing import Optional

# Окно, в течение которого пользователь считается онлайн. Должно совпадать
# с окном в admin.py: иначе счётчик в админке и бейджи в интерфейсе начнут
# расходиться на одних и тех же данных.
ONLINE_WINDOW_SECONDS = 120


def user_online(user: Optional["object"]) -> bool:
    """Онлайн ли пользователь по времени последней активности.

    Возвращает False для None и для пользователя, который ни разу не был
    активен (`last_seen IS NULL`). Ошибок не глушит: обе прежние копии
    глотали TypeError и превращали поломку в «все офлайн».
    """
    if user is None:
        return False

    last_seen = getattr(user, "last_seen", None)
    if not last_seen:
        return False

    # Обратная совместимость: до миграции b31957f1dbe9 колонка хранила строку.
    # Сейчас это datetime, но старые записи могли пережить миграцию.
    if isinstance(last_seen, str):
        try:
            last_seen = datetime.fromisoformat(last_seen)
        except ValueError:
            return False

    if last_seen.tzinfo is not None:
        # Приводим к naive UTC — именно в UTC сравниваем ниже. `astimezone()`
        # без аргумента дал бы местное время, и сравнение с `utcnow()` уехало
        # бы на величину смещения зоны (для Москвы — на 3 часа).
        last_seen = last_seen.astimezone(timezone.utc).replace(tzinfo=None)

    return (datetime.utcnow() - last_seen).total_seconds() < ONLINE_WINDOW_SECONDS
