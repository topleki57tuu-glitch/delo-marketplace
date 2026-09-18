"""payment records: confirmation url as proof of creation

Revision ID: 3f9d21c4ab07
Revises: c7a1e4b90d52
Create Date: 2026-09-18 13:45:00.000000

Добавляет `payment_records.confirmation_url`.

Зачем. `POST /payments/confirm` принимал `payment_id` из query-строки и
передавал его провайдеру: если тот отвечал `paid: true`, баланс пополнялся.
Запись `PaymentRecord` при этом искалась по тому же значению, которое прислал
клиент, — то есть своя запись и её же аргумент использовались как взаимное
доказательство. У ЮKassa `confirmation_url` не сохранялся нигде, поэтому
подтвердить платёж можно было, ни разу не открыв страницу оплаты: достаточно
знать `payment_id`.

`confirmation_url` формируется провайдером при создании платежа, сохраняется
здесь и возвращается клиенту. Клиент его не изобретает — значит, совпадение
при подтверждении доказывает, что подтверждается именно созданный нами платёж.
Проверка целиком локальная, к провайдеру не ходит: см.
`app/api/payments.py::_verify_local_record`.

Колонка nullable: старые записи URL не несут, и для них подтверждение из
браузера теперь отклоняется (409). Это намеренно — «не знаю, что это за
платёж» должно означать отказ, а не пропуск проверки. Такие платежи
закрываются вебхуком, где источником истины служит provider/label.

Миграция условная: на базе после create_all колонка уже есть — шаг
пропускается. Так же сделаны fa7bd76d26f3, 93df710954af, ac15c32ceed1 и
c7a1e4b90d52.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f9d21c4ab07'
down_revision: Union[str, Sequence[str], None] = 'c7a1e4b90d52'
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

    if 'confirmation_url' not in _columns('payment_records'):
        op.add_column(
            'payment_records',
            sa.Column('confirmation_url', sa.String(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if 'confirmation_url' in _columns('payment_records'):
        op.drop_column('payment_records', 'confirmation_url')
