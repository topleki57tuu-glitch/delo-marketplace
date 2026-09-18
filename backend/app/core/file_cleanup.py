"""Удаление записей о файлах, на которые никто не ссылается.

Логика вынесена из `app/tasks/cleanup.py` намеренно. Тот модуль на верхнем
уровне импортирует `celery`, которого нет в `backend/requirements.txt`
(и воркера нет ни в одном контуре развёртывания), поэтому его нельзя ни
запустить, ни протестировать, не поднимая celery. А это функция, которая
удаляет данные: её нужно уметь проверить.

Как было раньше и почему так больше нельзя. Задача сканировала каталог
`uploads/` на диске и удаляла всё, чего нет в БД. Две независимые причины,
по которым это не работало и было опасно:

1. Она падала при каждом запуске: обращалась к `StoredFile.path`, а такого
   поля у модели нет (`id`, `filename`, `content_type`, `data`, `created_at`).
   Падение прятал внешний `except Exception`.
2. Она удалила бы всё подряд. Загруженные файлы хранятся в БД
   (`StoredFile.data`), а не на диске, поэтому список «известных» файлов
   всегда получался пустым — и под удаление попадал любой файл в `uploads/`.

Как определяется «ни на что не ссылается». Ссылки на файл выглядят как
`/files/<id>` и лежат в текстовых колонках разных таблиц (`User.avatar`,
`User.portfolio`, `Task.images`, `Message.file_url`, `Product.images`).
Вместо перечисления колонок по именам — а его легко забыть обновить при
добавлении нового места хранения — проходим по всем строковым колонкам всех
таблиц моделей и собираем вхождения регуляркой. Новое место хранения
подхватится само.

Свежие записи не трогаем: файл могли загрузить и ещё не прикрепить.
"""
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy import String, Text, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models import StoredFile

# Ссылка на файл: `/files/123` или `/files/123?token=...`
FILE_URL_RE = re.compile(r"/files/(\d+)")


def file_id_from_url(url: Optional[str]) -> Optional[int]:
    """id файла из ссылки `/files/<id>` — с подписью или без.

    Нужна там, где по ссылке надо проверить права (например, приложил ли
    пользователь свой файл). Для всего остального (data-URL, внешний адрес,
    пустое значение) возвращает None — вызывающий сам решает, что это значит.
    """
    if not url:
        return None
    match = FILE_URL_RE.search(url)
    return int(match.group(1)) if match else None


def collect_referenced_file_ids(db: Session) -> set:
    """Все id файлов, на которые есть ссылка хотя бы в одной текстовой колонке."""
    referenced: set = set()

    for table in Base.metadata.sorted_tables:
        text_columns = [
            c.name for c in table.columns
            if isinstance(c.type, (String, Text))
        ]
        if not text_columns:
            continue

        rows = db.execute(select(*[table.c[name] for name in text_columns])).all()
        for row in rows:
            for value in row:
                if isinstance(value, str):
                    referenced.update(int(m) for m in FILE_URL_RE.findall(value))

    return referenced


def sweep_orphaned_files(db: Session, days_old: int = 7) -> Dict[str, Any]:
    """Удалить записи о файлах без ссылок, старше `days_old` дней.

    Возвращает {"deleted": int, "referenced": int}. Коммит делает вызывающий —
    так функцию можно проверить на тестовой базе, не фиксируя изменения.

    Удаления отправляются в БД через flush: в проекте
    `sessionmaker(autoflush=False)`, поэтому без явного flush состояние сессии
    и содержимое таблицы разъезжаются — «удалённые» записи продолжают
    выбираться запросами до коммита.
    """
    referenced = collect_referenced_file_ids(db)
    cutoff = datetime.utcnow() - timedelta(days=days_old)

    query = db.query(StoredFile).filter(StoredFile.created_at < cutoff)
    if referenced:
        query = query.filter(~StoredFile.id.in_(referenced))

    orphaned = query.all()
    for record in orphaned:
        db.delete(record)

    db.flush()
    return {"deleted": len(orphaned), "referenced": len(referenced)}
