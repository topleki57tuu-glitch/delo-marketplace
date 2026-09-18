"""migrate_datetime_to_native_timestamps

Revision ID: b31957f1dbe9
Revises: fa7bd76d26f3
Create Date: 2026-09-12 21:52:23.569226

Миграция ISO строк (VARCHAR) → native DateTime для всех datetime полей.

Преимущества:
- SQL функции работают корректно (WHERE created_at > NOW() - INTERVAL '7 days')
- Индексы быстрее
- Экономия места: 26 байт → 8 байт (~70%)
- Автоматическая валидация типа

ВАЖНО: Миграция конвертирует существующие данные.
Для production с большими таблицами рекомендуется maintenance окно.

ВАЖНО: список таблиц ниже включает и те, которых нет в начальной схеме
(refresh_tokens, products, orders) — они появились в моделях позже. Без
проверки существования `alembic upgrade head` на чистой базе падал с
«no such table». Проверка добавлена, миграция идемпотентна.

ВАЖНО: конвертация идёт разным SQL для разных СУБД. Изначально здесь были
только sqlite-функции datetime()/strftime(), из-за чего миграция падала на
PostgreSQL («function datetime(character varying) does not exist») — то есть
ровно там, где она и нужна. Теперь:
  - PostgreSQL: приведение через ::timestamp и to_char (с регуляркой, чтобы
    мусорные значения давали NULL, а не роняли миграцию);
  - SQLite: как раньше, datetime()/strftime();
  - прочие СУБД: конвертация на стороне Python.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'b31957f1dbe9'
down_revision: Union[str, Sequence[str], None] = 'fa7bd76d26f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_columns(table: str) -> set:
    """Колонки таблицы или пустое множество, если таблицы ещё нет."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _dialect_name() -> str:
    """Имя диалекта текущего подключения: 'sqlite', 'postgresql', ..."""
    return op.get_bind().dialect.name


def _to_datetime_expr(field: str, dialect: str) -> str:
    """SQL-выражение «строка ISO → DateTime» для нужного диалекта.

    `datetime()` и `strftime()` — функции SQLite; в PostgreSQL их нет, поэтому
    раньше `alembic upgrade head` на чистой базе Postgres падал с
    «function datetime(character varying) does not exist». В проде СУБД именно
    Postgres, так что миграция была нерабочей там, где она нужнее всего.
    """
    if dialect == "postgresql":
        # ISO-строку можно привести к timestamp напрямую, но мусорные значения
        # уронили бы всю миграцию. Регулярка отсеивает всё, что не похоже на
        # дату, и превращает такие значения в NULL — как это делает SQLite.
        return (
            f"CASE WHEN {field} ~ "
            f"'^\\d{{4}}-\\d{{2}}-\\d{{2}}' "
            f"THEN btrim({field}, '\"')::timestamp "
            f"ELSE NULL END"
        )
    if dialect == "sqlite":
        return f"datetime({field})"
    # Прочие СУБД: универсального приведения ISO-строки в SQL нет,
    # конвертируем на стороне Python.
    raise NotImplementedError(dialect)


def _to_string_expr(field: str, dialect: str) -> str:
    """SQL-выражение «DateTime → строка ISO» для нужного диалекта."""
    if dialect == "postgresql":
        return f"to_char({field}, 'YYYY-MM-DD\"T\"HH24:MI:SS')"
    if dialect == "sqlite":
        return f"strftime('%Y-%m-%dT%H:%M:%S', {field})"
    raise NotImplementedError(dialect)


def _convert_python_side(table: str, field: str, to_datetime: bool) -> None:
    """Фолбэк для СУБД без подходящих SQL-функций: конвертируем в Python.

    Читаем значения, преобразуем и пишем обратно через параметры — медленнее,
    но работает везде, где работает SQLAlchemy.
    """
    import datetime as _dt

    conn = op.get_bind()
    new_type = sa.DateTime() if to_datetime else sa.String()

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.add_column(sa.Column(f'{field}_temp', new_type, nullable=True))

    rows = conn.execute(
        text(f"SELECT id, {field} FROM {table} WHERE {field} IS NOT NULL")
    ).fetchall()

    for row_id, value in rows:
        if to_datetime:
            if isinstance(value, _dt.datetime):
                new_value = value
            else:
                try:
                    new_value = _dt.datetime.fromisoformat(str(value).strip().strip('"'))
                except ValueError:
                    new_value = None
        else:
            if isinstance(value, _dt.datetime):
                new_value = value.strftime("%Y-%m-%dT%H:%M:%S")
            else:
                new_value = None

        conn.execute(
            text(f"UPDATE {table} SET {field}_temp = :v WHERE id = :i"),
            {"v": new_value, "i": row_id},
        )

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_column(field)
        batch_op.alter_column(f'{field}_temp', new_column_name=field)


def _convert(table: str, field: str, to_datetime: bool) -> None:
    """Перелить одну колонку: VARCHAR(ISO) <-> DateTime, через временную колонку."""
    if field not in _table_columns(table):
        return

    conn = op.get_bind()
    dialect = _dialect_name()
    new_type = sa.DateTime() if to_datetime else sa.String()

    try:
        expr = (
            _to_datetime_expr(field, dialect)
            if to_datetime
            else _to_string_expr(field, dialect)
        )
    except NotImplementedError:
        _convert_python_side(table, field, to_datetime)
        return

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.add_column(sa.Column(f'{field}_temp', new_type, nullable=True))

    conn.execute(text(f"""
        UPDATE {table}
        SET {field}_temp = {expr}
        WHERE {field} IS NOT NULL AND {field} != ''
    """))

    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_column(field)
        batch_op.alter_column(f'{field}_temp', new_column_name=field)


def upgrade() -> None:
    """Upgrade schema: VARCHAR ISO strings → DateTime."""

    tables_fields = [
        ('users', ['created_at', 'last_seen', 'pro_until']),
        ('tasks', ['created_at']),
        ('messages', ['created_at']),
        ('transactions', ['created_at']),
        ('notifications', ['created_at']),  # read_at не существует
        ('disputes', ['created_at', 'resolved_at']),
        ('password_reset_tokens', ['created_at', 'expires_at']),
        ('refresh_tokens', ['created_at', 'expires_at', 'revoked_at']),
        ('verification_requests', ['created_at', 'resolved_at']),
        ('withdrawal_requests', ['created_at', 'resolved_at']),
        ('payment_records', ['created_at']),
        ('stored_files', ['created_at']),  # не uploaded_at
        # responses и reviews не имеют datetime полей в текущей схеме
    ]

    for table, fields in tables_fields:
        for field in fields:
            _convert(table, field, to_datetime=True)


def downgrade() -> None:
    """Downgrade schema: DateTime → VARCHAR ISO strings."""

    tables_fields = [
        ('users', ['created_at', 'last_seen', 'pro_until']),
        ('tasks', ['created_at']),
        ('messages', ['created_at']),
        ('transactions', ['created_at']),
        ('notifications', ['created_at']),  # read_at не существует
        ('disputes', ['created_at', 'resolved_at']),
        ('password_reset_tokens', ['created_at', 'expires_at']),
        ('refresh_tokens', ['created_at', 'expires_at', 'revoked_at']),
        ('verification_requests', ['created_at', 'resolved_at']),
        ('withdrawal_requests', ['created_at', 'resolved_at']),
        ('payment_records', ['created_at']),
        ('stored_files', ['created_at']),  # не uploaded_at
        # responses и reviews не имеют datetime полей в текущей схеме
    ]

    for table, fields in tables_fields:
        for field in fields:
            _convert(table, field, to_datetime=False)
