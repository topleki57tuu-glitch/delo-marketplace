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
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa7bd76d26f3'
down_revision: Union[str, Sequence[str], None] = 'b2dc7263be2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Используем batch_alter_table для поддержки SQLite
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_seen', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('response_credits', sa.Integer(), server_default='5', nullable=False))
        batch_op.add_column(sa.Column('is_pro', sa.Boolean(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('pro_until', sa.String(), nullable=True))

    with op.batch_alter_table('reviews', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target', sa.String(), server_default='specialist', nullable=False))

    with op.batch_alter_table('transactions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('fee', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('transactions', schema=None) as batch_op:
        batch_op.drop_column('fee')

    with op.batch_alter_table('reviews', schema=None) as batch_op:
        batch_op.drop_column('target')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('pro_until')
        batch_op.drop_column('is_pro')
        batch_op.drop_column('response_credits')
        batch_op.drop_column('last_seen')
