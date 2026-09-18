"""stored files: owner and private scope

Revision ID: b4e1a7c25d38
Revises: 3f9d21c4ab07
Create Date: 2026-09-18 20:20:00.000000

Добавляет `stored_files.owner_id` и `stored_files.is_private`.

Зачем. `GET /files/{id}` отдавал файл кому угодно, без токена и проверки
владельца, а `id` — последовательное целое: содержимое перебиралось от 1.
До сих пор через загрузку проходили только аватар, фото задания, фото товара
и портфолио — всё публичное по смыслу, поэтому утечки не было. Но вложения в
чате — это личная переписка, и они переезжают с base64 (который раздувал ответ
чтения чата линейно от числа картинок) на `/files/{id}`. Без разделения на
публичное и приватное такой переезд сам создал бы дыру.

Теперь:
  * `is_private = false` — файл отдаётся как раньше, по прямой ссылке.
    Это аватары, фото заданий и товаров, портфолио.
  * `is_private = true` — нужна подпись в query-строке. Подпись считает сервер
    (`app/core/security.py::sign_file_token`) и подставляет её только в те
    ответы, где у получателя есть право видеть файл — то есть в сообщения
    своей сделки (`app/api/chat.py`).

`owner_id` нужен для `DELETE /files/{id}`: удалить свой файл можно, чужой —
нет. У старых записей он NULL, и такие файлы через API не удаляются —
владелец неизвестен, а угадывать его нельзя.

Обе колонки nullable/default-безопасные, поэтому существующие записи
становятся публичными и доступ к ним не меняется.

Миграция условная: на базе после create_all колонки уже есть — шаг
пропускается. Так же сделаны fa7bd76d26f3, ac15c32ceed1, c7a1e4b90d52
и 3f9d21c4ab07.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e1a7c25d38'
down_revision: Union[str, Sequence[str], None] = '3f9d21c4ab07'
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
    if 'stored_files' not in sa.inspect(op.get_bind()).get_table_names():
        return

    columns = _columns('stored_files')

    if 'owner_id' not in columns:
        op.add_column(
            'stored_files',
            sa.Column('owner_id', sa.Integer(), nullable=True),
        )
        op.create_index('ix_stored_files_owner_id', 'stored_files', ['owner_id'])

    if 'is_private' not in columns:
        op.add_column(
            'stored_files',
            sa.Column(
                'is_private',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        op.create_index('ix_stored_files_is_private', 'stored_files', ['is_private'])


def downgrade() -> None:
    """Downgrade schema."""
    columns = _columns('stored_files')

    if 'is_private' in columns:
        op.drop_index('ix_stored_files_is_private', table_name='stored_files')
        op.drop_column('stored_files', 'is_private')

    if 'owner_id' in columns:
        op.drop_index('ix_stored_files_owner_id', table_name='stored_files')
        op.drop_column('stored_files', 'owner_id')
