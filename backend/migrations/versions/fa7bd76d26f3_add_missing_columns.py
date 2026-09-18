"""add_missing_columns

Revision ID: fa7bd76d26f3
Revises: b2dc7263be2e
Create Date: 2026-09-12 21:10:37.201741

Добавляет колонки, которые раньше создавались через самописные миграции в main.py:
- users.last_seen
- reviews.target
- users.response_credits
- users.is_pro
- users.pro_until
- transactions.fee

ВАЖНО: миграция условная. Эти же колонки уже присутствуют в начальной схеме
(4634d648e920), поэтому безусловный add_column ронял `alembic upgrade head`
на чистой базе с «duplicate column name: last_seen». Изначально миграция
писалась под базу, созданную приложением через create_all, а не под цепочку
миграций.

Условный вариант закрывает оба случая:
- чистая база по цепочке миграций — колонки есть, ничего не делаем;
- унаследованная база после create_all — добавляем то, чего не хватает.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa7bd76d26f3'
down_revision: Union[str, Sequence[str], None] = 'b2dc7263be2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set:
    bind = op.get_bind()
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _add_missing(table: str, columns) -> None:
    """Добавить только отсутствующие колонки (batch-режим нужен для SQLite)."""
    existing = _existing_columns(table)
    missing = [(name, col) for name, col in columns if name not in existing]
    if not missing:
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        for name, col in missing:
            batch_op.add_column(col)


def _drop_present(table: str, names) -> None:
    existing = _existing_columns(table)
    present = [n for n in names if n in existing]
    if not present:
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        for name in present:
            batch_op.drop_column(name)


def upgrade() -> None:
    """Upgrade schema."""
    _add_missing('users', [
        ('last_seen', sa.Column('last_seen', sa.String(), nullable=True)),
        ('response_credits', sa.Column('response_credits', sa.Integer(), server_default='5', nullable=False)),
        ('is_pro', sa.Column('is_pro', sa.Boolean(), server_default='0', nullable=False)),
        ('pro_until', sa.Column('pro_until', sa.String(), nullable=True)),
    ])
    _add_missing('reviews', [
        ('target', sa.Column('target', sa.String(), server_default='specialist', nullable=False)),
    ])
    _add_missing('transactions', [
        ('fee', sa.Column('fee', sa.Integer(), server_default='0', nullable=False)),
    ])


def downgrade() -> None:
    """Downgrade schema."""
    _drop_present('transactions', ['fee'])
    _drop_present('reviews', ['target'])
    _drop_present('users', ['pro_until', 'is_pro', 'response_credits', 'last_seen'])
