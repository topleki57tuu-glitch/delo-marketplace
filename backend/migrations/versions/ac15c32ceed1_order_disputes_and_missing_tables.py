"""order disputes and missing tables

Revision ID: ac15c32ceed1
Revises: af27b7191ef4
Create Date: 2026-09-18 09:43:27.052333

Закрывает два пробела в цепочке миграций:

1. **Спор по заказу товара.** В `disputes` добавлено `order_id`: теперь одна
   таблица и одна очередь арбитра обслуживают и задания (`task_id`), и заказы
   товаров (`order_id`). Раньше спор по товару было невозможно открыть вообще —
   `OrderStatus.disputed` существовал, но недостижим, и деньги покупателя
   могли остаться в эскроу навсегда.

2. **Отсутствующие таблицы.** `orders`, `products` и `refresh_tokens` появились
   в моделях уже после того, как была написана цепочка миграций, и ни одна
   ревизия их не создавала. База, поднятая миграциями, не совпадала с моделями:
   приложение падало бы на первом обращении к товарам или к refresh-токену.

Миграция условная: на базе, созданной приложением через create_all, эти таблицы
и колонка уже есть — тогда шаг просто пропускается. Так же сделаны
fa7bd76d26f3 и 93df710954af.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ac15c32ceed1'
down_revision: Union[str, Sequence[str], None] = 'af27b7191ef4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    tables = _tables()

    if 'orders' not in tables:
        op.create_table('orders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=True),
        sa.Column('buyer_id', sa.Integer(), nullable=True),
        sa.Column('seller_id', sa.Integer(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=True),
        sa.Column('total_price', sa.Integer(), nullable=False),
        sa.Column('delivery_method', sa.String(), nullable=True),
        sa.Column('delivery_address', sa.Text(), nullable=True),
        sa.Column('tracking_number', sa.String(), nullable=True),
        sa.Column('status', sa.Enum('pending', 'confirmed', 'shipped', 'delivered', 'completed', 'disputed', 'cancelled', name='orderstatus'), nullable=True),
        sa.Column('escrow_transaction_id', sa.Integer(), nullable=True),
        sa.Column('platform_fee', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('orders', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_orders_buyer_id'), ['buyer_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_orders_id'), ['id'], unique=False)
            batch_op.create_index(batch_op.f('ix_orders_product_id'), ['product_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_orders_seller_id'), ['seller_id'], unique=False)

    if 'products' not in tables:
        op.create_table('products',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('seller_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('category', sa.Enum('electronics', 'clothing', 'home', 'hobby', 'auto', 'kids', 'other', name='productcategory'), nullable=True),
        sa.Column('condition', sa.Enum('new', 'used', name='productcondition'), nullable=True),
        sa.Column('price', sa.Integer(), nullable=False),
        sa.Column('stock', sa.Integer(), nullable=True),
        sa.Column('images', sa.Text(), nullable=True),
        sa.Column('city', sa.String(), nullable=True),
        sa.Column('delivery_options', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('products', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_products_category'), ['category'], unique=False)
            batch_op.create_index(batch_op.f('ix_products_city'), ['city'], unique=False)
            batch_op.create_index(batch_op.f('ix_products_id'), ['id'], unique=False)
            batch_op.create_index(batch_op.f('ix_products_seller_id'), ['seller_id'], unique=False)

    if 'refresh_tokens' not in tables:
        op.create_table('refresh_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('token', sa.String(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('revoked', sa.Boolean(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_refresh_tokens_id'), ['id'], unique=False)
            batch_op.create_index(batch_op.f('ix_refresh_tokens_token'), ['token'], unique=True)
            batch_op.create_index(batch_op.f('ix_refresh_tokens_user_id'), ['user_id'], unique=False)

    # Спор по заказу товара: колонка может уже существовать на базе после create_all
    if 'order_id' not in _columns('disputes'):
        with op.batch_alter_table('disputes', schema=None) as batch_op:
            batch_op.add_column(sa.Column('order_id', sa.Integer(), nullable=True))
            batch_op.create_index(batch_op.f('ix_disputes_order_id'), ['order_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    if 'order_id' in _columns('disputes'):
        with op.batch_alter_table('disputes', schema=None) as batch_op:
            batch_op.drop_index(batch_op.f('ix_disputes_order_id'))
            batch_op.drop_column('order_id')

    tables = _tables()
    for table in ('refresh_tokens', 'products', 'orders'):
        if table in tables:
            op.drop_table(table)

    # PG-типы, созданные этой миграцией, живут отдельно от таблиц: без
    # явного DROP повторный `upgrade` после `downgrade` падает с «тип
    # orderstatus уже существует». На SQLite шаг не нужен.
    if op.get_bind().dialect.name == "postgresql":
        for type_name in ('orderstatus', 'productcategory', 'productcondition'):
            op.execute(f"DROP TYPE IF EXISTS {type_name}")
