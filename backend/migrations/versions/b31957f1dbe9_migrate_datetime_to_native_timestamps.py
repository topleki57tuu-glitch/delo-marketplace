"""migrate_datetime_to_native_timestamps

Revision ID: b31957f1dbe9
Revises: fa7bd76d26f3
Create Date: 2026-09-12 21:52:23.569226

Миграция ISO строк (VARCHAR) → native DateTime для всех datetime полей.

Преимущества:
- SQL функции работают корректно (WHERE created_at > NOW() - INTERVAL '7 days')
- Индексы быстрее
- Экономия места: 26 байт → 8 байт (~70%)
- Автоматическая валидация типа

ВАЖНО: Миграция конвертирует существующие данные.
Для production с большими таблицами рекомендуется maintenance окно.

ВАЖНО: список таблиц ниже включает и те, которых нет в начальной схеме
(refresh_tokens, products, orders) — они появились в моделях позже. Без
проверки существования `alembic upgrade head` на чистой базе падал с
«no such table». Проверка добавлена, миграция идемпотентна.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'b31957f1dbe9'
down_revision: Union[str, Sequence[str], None] = 'fa7bd76d26f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_columns(table: str) -> set:
    """Колонки таблицы или пустое множество, если таблицы ещё нет."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _convert(table: str, field: str, to_datetime: bool) -> None:
    """Перелить одну колонку: VARCHAR(ISO) <-> DateTime, через временную колонку."""
    if field not in _table_columns(table):
        return

    conn = op.get_bind()
    new_type = sa.DateTime() if to_datetime else sa.String()

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.add_column(sa.Column(f'{field}_temp', new_type, nullable=True))

    if to_datetime:
        conn.execute(text(f"""
            UPDATE {table}
            SET {field}_temp = datetime({field})
            WHERE {field} IS NOT NULL AND {field} != ''
        """))
    else:
        conn.execute(text(f"""
            UPDATE {table}
            SET {field}_temp = strftime('%Y-%m-%dT%H:%M:%S', {field})
            WHERE {field} IS NOT NULL
        """))

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_column(field)
        batch_op.alter_column(f'{field}_temp', new_column_name=field)


def upgrade() -> None:
    """Upgrade schema: VARCHAR ISO strings → DateTime."""

    tables_fields = [
        ('users', ['created_at', 'last_seen', 'pro_until']),
        ('tasks', ['created_at']),
        ('messages', ['created_at']),
        ('transactions', ['created_at']),
        ('notifications', ['created_at']),  # read_at не существует
        ('disputes', ['created_at', 'resolved_at']),
        ('password_reset_tokens', ['created_at', 'expires_at']),
        ('refresh_tokens', ['created_at', 'expires_at', 'revoked_at']),
        ('verification_requests', ['created_at', 'resolved_at']),
        ('withdrawal_requests', ['created_at', 'resolved_at']),
        ('payment_records', ['created_at']),
        ('stored_files', ['created_at']),  # не uploaded_at
        # responses и reviews не имеют datetime полей в текущей схеме
    ]

    for table, fields in tables_fields:
        for field in fields:
            _convert(table, field, to_datetime=True)


def downgrade() -> None:
    """Downgrade schema: DateTime → VARCHAR ISO strings."""

    tables_fields = [
        ('users', ['created_at', 'last_seen', 'pro_until']),
        ('tasks', ['created_at']),
        ('messages', ['created_at']),
        ('transactions', ['created_at']),
        ('notifications', ['created_at']),  # read_at не существует
        ('disputes', ['created_at', 'resolved_at']),
        ('password_reset_tokens', ['created_at', 'expires_at']),
        ('refresh_tokens', ['created_at', 'expires_at', 'revoked_at']),
        ('verification_requests', ['created_at', 'resolved_at']),
        ('withdrawal_requests', ['created_at', 'resolved_at']),
        ('payment_records', ['created_at']),
        ('stored_files', ['created_at']),  # не uploaded_at
        # responses и reviews не имеют datetime полей в текущей схеме
    ]

    for table, fields in tables_fields:
        for field in fields:
            _convert(table, field, to_datetime=False)
