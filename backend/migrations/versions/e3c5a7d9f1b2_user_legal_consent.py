"""user legal consent

Когда пользователь принял пользовательское соглашение, когда дал согласие
на обработку персональных данных и какую редакцию документов видел.

Существующим аккаунтам значения не проставляем: согласия от них никто не
получал, а записать его задним числом — значит подделать. Фронтенд покажет
им окно с документами при следующем входе.

Revision ID: e3c5a7d9f1b2
Revises: b4e1a7c25d38
Create Date: 2026-11-01 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3c5a7d9f1b2'
down_revision: Union[str, Sequence[str], None] = 'b4e1a7c25d38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ('terms_accepted_at', sa.DateTime()),
    ('pd_consent_at', sa.DateTime()),
    ('legal_version', sa.String()),
)


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    existing = _columns('users')
    for name, type_ in _COLUMNS:
        if name not in existing:
            op.add_column('users', sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    existing = _columns('users')
    for name, _ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column('users', name)
