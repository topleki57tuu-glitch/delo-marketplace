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


def upgrade() -> None:
    """Upgrade schema: VARCHAR ISO strings → DateTime."""

    # Определяем таблицы и их datetime поля (только те, что реально существуют в БД)
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

    conn = op.get_bind()

    for table, fields in tables_fields:
        for field in fields:
            # Используем batch_alter_table для поддержки SQLite
            with op.batch_alter_table(table, schema=None) as batch_op:
                # 1. Создаём временную колонку DateTime
                batch_op.add_column(sa.Column(f'{field}_temp', sa.DateTime(), nullable=True))

            # 2. Конвертируем ISO строки в DateTime
            # SQLite: datetime(field) конвертирует ISO строку
            # PostgreSQL: TO_TIMESTAMP работает аналогично
            conn.execute(text(f"""
                UPDATE {table}
                SET {field}_temp = datetime({field})
                WHERE {field} IS NOT NULL AND {field} != ''
            """))

            with op.batch_alter_table(table, schema=None) as batch_op:
                # 3. Удаляем старую колонку VARCHAR
                batch_op.drop_column(field)

                # 4. Переименовываем временную колонку
                batch_op.alter_column(f'{field}_temp', new_column_name=field)


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

    conn = op.get_bind()

    for table, fields in tables_fields:
        for field in fields:
            with op.batch_alter_table(table, schema=None) as batch_op:
                # 1. Создаём временную колонку VARCHAR
                batch_op.add_column(sa.Column(f'{field}_temp', sa.String(), nullable=True))

            # 2. Конвертируем DateTime обратно в ISO строку
            # SQLite: strftime возвращает ISO формат
            conn.execute(text(f"""
                UPDATE {table}
                SET {field}_temp = strftime('%Y-%m-%dT%H:%M:%S', {field})
                WHERE {field} IS NOT NULL
            """))

            with op.batch_alter_table(table, schema=None) as batch_op:
                # 3. Удаляем DateTime колонку
                batch_op.drop_column(field)

                # 4. Переименовываем временную колонку
                batch_op.alter_column(f'{field}_temp', new_column_name=field)

