"""add_performance_indexes

Revision ID: af27b7191ef4
Revises: 93df710954af
Create Date: 2026-09-13

Добавление индексов для оптимизации производительности:
- idx_tasks_status: фильтрация по статусу задачи
- idx_tasks_category: фильтрация по категории
- idx_tasks_customer_status: задачи заказчика по статусу
- idx_tasks_executor_status: задачи исполнителя по статусу
- idx_users_last_seen: проверка онлайн статуса пользователя

Ожидаемые улучшения:
- Ускорение запросов на 40-60% при фильтрации задач
- Устранение full table scan на больших таблицах
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'af27b7191ef4'
down_revision: Union[str, Sequence[str], None] = '93df710954af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Индексы для оптимизации запросов к задачам
    op.create_index('idx_tasks_status', 'tasks', ['status'], unique=False)
    op.create_index('idx_tasks_category', 'tasks', ['category'], unique=False)
    op.create_index('idx_tasks_customer_status', 'tasks', ['customer_id', 'status'], unique=False)
    op.create_index('idx_tasks_executor_status', 'tasks', ['executor_id', 'status'], unique=False)

    # Индекс для проверки онлайн статуса пользователей
    op.create_index('idx_users_last_seen', 'users', ['last_seen'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Удаление индексов в обратном порядке
    op.drop_index('idx_users_last_seen', table_name='users')
    op.drop_index('idx_tasks_executor_status', table_name='tasks')
    op.drop_index('idx_tasks_customer_status', table_name='tasks')
    op.drop_index('idx_tasks_category', table_name='tasks')
    op.drop_index('idx_tasks_status', table_name='tasks')
