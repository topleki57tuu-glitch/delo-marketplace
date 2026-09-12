# Миграция datetime: ISO строки -> native timestamps

## Проблема
Все datetime поля в моделях используют `Column(String)` с ISO строками:
```python
created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
```

**Недостатки**:
- Нельзя использовать SQL функции для работы с датами
- Сложно делать range queries (WHERE created_at > ...)
- Нет автоматической валидации формата
- Больше места в БД (строки vs timestamps)

## Решение

### Этап 1: Создать Alembic миграцию (рекомендуется)

**Для новых проектов** или **при наличии времени на миграцию**:

```bash
cd backend
alembic revision -m "migrate_datetime_to_native_timestamps"
```

Отредактировать созданную миграцию:

```python
"""migrate datetime to native timestamps

Revision ID: xxxx
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

def upgrade():
    # Для каждой таблицы с datetime полями
    tables_fields = [
        ('users', ['created_at']),
        ('tasks', ['created_at']),
        ('messages', ['created_at']),
        ('transactions', ['created_at']),
        ('notifications', ['created_at', 'read_at']),
        ('reviews', ['created_at']),
        ('disputes', ['created_at', 'resolved_at']),
        ('password_reset_tokens', ['created_at', 'expires_at']),
        ('refresh_tokens', ['created_at', 'expires_at', 'revoked_at']),
        ('verification_requests', ['created_at', 'resolved_at']),
        ('withdrawal_requests', ['created_at', 'resolved_at']),
        ('payment_records', ['created_at']),
        ('responses', ['created_at']),
    ]
    
    conn = op.get_bind()
    
    for table, fields in tables_fields:
        for field in fields:
            # Создаём временную колонку
            op.add_column(table, sa.Column(f'{field}_temp', sa.DateTime(), nullable=True))
            
            # Конвертируем ISO строки в datetime
            # PostgreSQL: TO_TIMESTAMP(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
            # SQLite: datetime(created_at)
            conn.execute(text(f"""
                UPDATE {table}
                SET {field}_temp = datetime({field})
                WHERE {field} IS NOT NULL
            """))
            
            # Удаляем старую колонку
            op.drop_column(table, field)
            
            # Переименовываем временную
            op.alter_column(table, f'{field}_temp', new_column_name=field)

def downgrade():
    # Обратная миграция (DateTime -> String)
    tables_fields = [
        ('users', ['created_at']),
        # ... все остальные
    ]
    
    conn = op.get_bind()
    
    for table, fields in tables_fields:
        for field in fields:
            op.add_column(table, sa.Column(f'{field}_temp', sa.String(), nullable=True))
            
            conn.execute(text(f"""
                UPDATE {table}
                SET {field}_temp = strftime('%Y-%m-%dT%H:%M:%S', {field})
                WHERE {field} IS NOT NULL
            """))
            
            op.drop_column(table, field)
            op.alter_column(table, f'{field}_temp', new_column_name=field)
```

Применить:
```bash
alembic upgrade head
```

### Этап 2: Обновить модели

После миграции обновить все модели на `DateTime`:

```python
from sqlalchemy import DateTime

class User(Base):
    created_at = Column(DateTime, default=datetime.utcnow)  # БЕЗ .isoformat()!

class Task(Base):
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
class Message(Base):
    created_at = Column(DateTime, default=datetime.utcnow)
```

### Этап 3: Обновить API endpoints

SQLAlchemy будет возвращать Python `datetime` объекты. FastAPI автоматически сериализует их в ISO строки в JSON.

**Ничего менять не нужно** - всё работает прозрачно!

---

## Альтернатива: Гибридный подход (для production БЕЗ downtime)

Если БД уже в production и нельзя останавливать:

1. Добавить новые колонки `*_dt` (DateTime) параллельно старым
2. Постепенно перенести данные
3. Обновить код на чтение из новых колонок
4. После проверки удалить старые колонки

---

## Преимущества после миграции

✅ **SQL запросы с датами**:
```python
# До: работать не будет корректно
tasks = db.query(Task).filter(Task.created_at > '2026-01-01T00:00:00')

# После: корректные range queries
from datetime import datetime, timedelta
week_ago = datetime.utcnow() - timedelta(days=7)
recent_tasks = db.query(Task).filter(Task.created_at > week_ago)
```

✅ **Индексы работают правильно**:
```python
# Индекс на DateTime быстрее чем на String
Column(DateTime, index=True)
```

✅ **Меньше места в БД**:
- String ISO: `"2026-09-12T20:30:15.123456"` (26 байт)
- DateTime: 8 байт в PostgreSQL

✅ **Автоматическая валидация**:
```python
task.created_at = "invalid"  # Ошибка типа, не попадёт в БД
```

---

## Рекомендация

**Для ДЕЛО Marketplace**:

Т.к. проект ещё не в production с реальными пользователями, **рекомендую сделать миграцию сейчас**:

1. Создать Alembic миграцию
2. Обновить все модели на `DateTime`
3. Протестировать E2E тесты
4. Задеплоить с чистой БД

**Время**: ~2-3 часа работы  
**Выгода**: Чистая архитектура на годы вперёд

---

**Статус**: 📝 Инструкция подготовлена, миграцию можно применить перед production запуском
