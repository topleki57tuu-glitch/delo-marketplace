"""payment records: provider and crediting status

Revision ID: c7a1e4b90d52
Revises: ac15c32ceed1
Create Date: 2026-09-18 11:55:00.000000

`payment_records` изначально задумывалась как журнал «что зачислили». Но
зачислять по ней было нельзя: запись создавалась ПОСЛЕ оплаты, по данным
вебхука. Сам же вебхук в те времена не работал вовсе (sync-эндпоинт с
`asyncio.run` внутри), поэтому дефект не проявлялся.

Теперь запись создаётся в момент оформления платежа и служит единственным
достоверным источником `user_id` и суммы для вебхука — `label`, который
присылает провайдер, формирует плательщик и потому подделывается.

Новые колонки:

- `provider` — yoomoney | yookassa, чтобы различать источники в журнале;
- `status` — created | paid, отдельный от факта зачисления;
- `credited_at` — момент зачисления; NOT NULL означает «уже зачислен» и
  служит признаком идемпотентности (вебхук и confirm могут прийти оба).

Миграция условная: на базе после create_all колонки уже есть — шаг
пропускается. Так же сделаны fa7bd76d26f3, 93df710954af и ac15c32ceed1.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7a1e4b90d52'
down_revision: Union[str, Sequence[str], None] = 'ac15c32ceed1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    if 'payment_records' not in sa.inspect(op.get_bind()).get_table_names():
        return

    existing = _columns('payment_records')
    had_status = 'status' in existing
    had_credited_at = 'credited_at' in existing

    if 'provider' not in existing:
        op.add_column(
            'payment_records',
            sa.Column('provider', sa.String(), nullable=True, server_default='yoomoney'),
        )

    if not had_status:
        op.add_column(
            'payment_records',
            sa.Column(
                'status',
                sa.Enum('created', 'paid', name='paymentstatus'),
                nullable=True,
            ),
        )

    if not had_credited_at:
        op.add_column(
            'payment_records',
            sa.Column('credited_at', sa.DateTime(), nullable=True),
        )

    # Записи, сделанные старым кодом, попадали в таблицу только по факту
    # оплаты — значит, все они уже зачислены. Помечаем их, чтобы вебхук не
    # начислил сумму второй раз. Если колонки уже были (база после
    # create_all), не трогаем ничего: там данных могло и не быть, а
    # перезапись статусов затёрла бы фактическое состояние.
    if not had_credited_at:
        op.execute(
            "UPDATE payment_records "
            "SET credited_at = created_at, status = 'paid' "
            "WHERE credited_at IS NULL"
        )


def downgrade() -> None:
    """Downgrade schema."""
    existing = _columns('payment_records')

    if 'credited_at' in existing:
        op.drop_column('payment_records', 'credited_at')
    if 'status' in existing:
        op.drop_column('payment_records', 'status')
    if 'provider' in existing:
        op.drop_column('payment_records', 'provider')
