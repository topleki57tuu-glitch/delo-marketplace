"""telegram bot: chats, link tokens, deliveries

Новый бот (app/telegram/) хранит всё в базе: фильтры «Радара заказов»,
привязку чата к аккаунту и отметки о том, что уже отправлено. Прежний бот
держал подписки в файле внутри контейнера, и они пропадали при каждом его
пересоздании.

Revision ID: 9b3e5f7a1c2d
Revises: d8e2f4a6b1c3
Create Date: 2026-11-03 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b3e5f7a1c2d'
down_revision: Union[str, Sequence[str], None] = 'd8e2f4a6b1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if 'telegram_chats' not in existing:
        op.create_table(
            'telegram_chats',
            sa.Column('chat_id', sa.BigInteger(), primary_key=True, autoincrement=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('linked_at', sa.DateTime(), nullable=True),
            sa.Column('radar_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('categories', sa.Text(), nullable=True),
            sa.Column('min_budget', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('city', sa.String(), nullable=True),
            sa.Column('notify_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('notify_since', sa.DateTime(), nullable=True),
            sa.Column('awaiting', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_telegram_chats_user_id', 'telegram_chats', ['user_id'], unique=True)
    if 'telegram_link_tokens' not in existing:
        op.create_table(
            'telegram_link_tokens',
            sa.Column('token_hash', sa.String(length=64), primary_key=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_telegram_link_tokens_user_id', 'telegram_link_tokens', ['user_id'])
    if 'telegram_deliveries' not in existing:
        op.create_table(
            'telegram_deliveries',
            sa.Column('kind', sa.String(length=1), primary_key=True),
            sa.Column('object_id', sa.Integer(), primary_key=True, autoincrement=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_telegram_deliveries_created_at', 'telegram_deliveries', ['created_at'])


def downgrade() -> None:
    existing = _tables()
    for table in ('telegram_deliveries', 'telegram_link_tokens', 'telegram_chats'):
        if table in existing:
            op.drop_table(table)
