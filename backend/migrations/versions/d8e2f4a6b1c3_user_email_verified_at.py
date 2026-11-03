"""user email verified at

Когда пользователь подтвердил почту по ссылке из письма
(app/core/email_verification.py). NULL — не подтверждена.

Существующим аккаунтам значение не проставляем: их адреса никто не
проверял, а отметить «подтверждено» задним числом — значит выдать за
проверенное то, что не проверялось. Сайт покажет им полоску «Подтвердите
почту» с кнопкой «Отправить письмо ещё раз». Вывод денег требует
подтверждённой почты, только когда на сервере настроена отправка писем.

Колонка необязательная, поэтому откат кода на прошлую версию (rollback.bat)
с ней работает: старый код её просто не читает.

Revision ID: d8e2f4a6b1c3
Revises: 6a770c7c2088
Create Date: 2026-11-03 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e2f4a6b1c3'
down_revision: Union[str, Sequence[str], None] = '6a770c7c2088'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    if 'email_verified_at' not in _columns('users'):
        op.add_column('users', sa.Column('email_verified_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if 'email_verified_at' in _columns('users'):
        op.drop_column('users', 'email_verified_at')
