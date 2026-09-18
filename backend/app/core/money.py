"""Изменение баланса пользователя — единственное место в проекте.

Правило: баланс меняет сам `UPDATE` с условием на текущее значение, а не
Python-код вида «прочитал — сравнил — записал». Второй вариант допускает
гонку: два параллельных запроса читают один и тот же баланс, оба проходят
проверку и оба списывают. Это не гипотеза — на аудите 18.09.2026 так
получилось вывести 2000 ₽ с баланса в 1000 ₽ (две одновременные заявки).

`SELECT ... FOR UPDATE` эту задачу не решает: на SQLite (БД по умолчанию в
разработке) он просто игнорируется, а на PostgreSQL требует блокировки строки
в правильном порядке, что легко перепутать. Условный UPDATE работает
одинаково везде и не оставляет места для ошибки.
"""
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import User


def credit_balance(db: Session, user_id: int, amount: int) -> None:
    """Начислить сумму на баланс."""
    if amount < 0:
        raise ValueError("credit_balance: сумма не может быть отрицательной")
    db.query(User).filter(User.id == user_id).update(
        {"balance": func.coalesce(User.balance, 0) + amount},
        synchronize_session=False,
    )


def debit_balance(db: Session, user_id: int, amount: int) -> bool:
    """Списать сумму, если средств достаточно.

    Возвращает False, если денег не хватило (в том числе если их успел
    потратить параллельный запрос). Вызывающий обязан сделать rollback
    и вернуть пользователю ошибку.
    """
    if amount < 0:
        raise ValueError("debit_balance: сумма не может быть отрицательной")
    updated = (
        db.query(User)
        .filter(User.id == user_id, func.coalesce(User.balance, 0) >= amount)
        .update(
            {"balance": func.coalesce(User.balance, 0) - amount},
            synchronize_session=False,
        )
    )
    return updated == 1


def claim(db: Session, model: Any, filters: list, values: dict) -> bool:
    """Атомарно перевести строку в новое состояние.

    True — переход сделан именно этим запросом. False — строку уже изменил
    кто-то другой (например, второе одновременное нажатие «отклонить»).
    """
    return db.query(model).filter(*filters).update(values, synchronize_session=False) == 1
