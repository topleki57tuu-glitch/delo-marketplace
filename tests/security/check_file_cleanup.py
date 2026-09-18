"""
Регресс: уборка «осиротевших» файлов не удаляет файлы, на которые есть ссылки.

Запуск (из корня репозитория):
    python tests/security/check_file_cleanup.py

Код возврата: 0 — убирается только мусор, 1 — под удаление попал нужный файл.

Почему этот файл существует
---------------------------
Задача `cleanup_orphaned_files` удаляет данные, а проверить её было нельзя:
`app/tasks/cleanup.py` на верхнем уровне импортирует celery, которого нет ни в
`requirements.txt`, ни в одном контуре развёртывания. Пока код жил там, у него
были две независимые поломки, и обе всплыли только при чтении:

1. Задача падала при каждом запуске — обращалась к `StoredFile.path`, а такого
   поля у модели нет. Падение прятал внешний `except Exception`, поэтому в
   логах была тишина, а задача числилась рабочей.
2. Даже если бы она не падала, она удалила бы всё подряд: файлы хранятся в БД
   (`StoredFile.data`), а не на диске, поэтому список «известных» файлов
   всегда получался пустым.

Логика переехала в `app/core/file_cleanup.py` — модуль без celery, который
можно запустить и проверить. Этот файл проверяет именно её.

Что здесь важно
---------------
Ссылки на файлы лежат в шести разных местах: `User.avatar`, `User.portfolio`,
`Task.images`, `Message.file_url`, `VerificationRequest.file_url`,
`Product.images`. Список, поддерживаемый руками, при добавлении седьмого места
молча перестаёт быть полным — и тогда уборка удаляет живые файлы. Поэтому
проверяется, что ссылка находится в каждой из таблиц, включая ту, которую
легко забыть: `VerificationRequest.file_url` — это фото паспорта.
"""
import os
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("check_file_cleanup")

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.file_cleanup import collect_referenced_file_ids, sweep_orphaned_files  # noqa: E402
from app.models import (  # noqa: E402
    Message, Product, StoredFile, Task, User, VerificationRequest,
)

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


OLD = datetime.utcnow() - timedelta(days=30)      # старше порога уборки
FRESH = datetime.utcnow() - timedelta(minutes=5)  # свежий, трогать нельзя
DAYS_OLD = 7


def make_file(db, filename: str, created_at, payload: bytes = b"\xff\xd8\xffimage"):
    record = StoredFile(filename=filename, content_type="image/jpeg",
                        data=payload, created_at=created_at)
    db.add(record)
    db.flush()
    return record.id


Base.metadata.create_all(bind=engine)

db = SessionLocal()

# --- файлы -----------------------------------------------------------------
# 1. аватар пользователя
avatar_id = make_file(db, "avatar.jpg", OLD)
# 2. вложение в чате — ссылка идёт с подписью (?token=...)
chat_id = make_file(db, "contract.pdf", OLD)
# 3. фото в задании — ссылки лежат в JSON-строке
task_photo_id = make_file(db, "task1.jpg", OLD)
# 4. фото паспорта в заявке на верификацию — то место, которое легко забыть
passport_id = make_file(db, "passport.jpg", OLD)
# 5. фото товара
product_id = make_file(db, "product.jpg", OLD)
# 6. мусор: загружен, нигде не прикреплён, старый → должен быть удалён
orphan_id = make_file(db, "orphan.jpg", OLD)
# 7. мусор, но свежий → удалять нельзя, файл могли ещё не прикрепить
fresh_orphan_id = make_file(db, "just_uploaded.jpg", FRESH)

user = User(email="cleanup@check.ru", hashed_password="x",
            avatar=f"/files/{avatar_id}",
            portfolio=f'[{{"url": "/files/{avatar_id}"}}]')
db.add(user)

task = Task(title="Задача", description="d", budget=1000, customer_id=1,
            images=f'["/files/{task_photo_id}", "/files/{avatar_id}"]')
db.add(task)

product = Product(seller_id=1, title="Товар", description="d", price=100,
                  images=f'["/files/{product_id}"]')
db.add(product)

verification = VerificationRequest(user_id=1, full_name="Иванов И. И.",
                                   file_url=f"/files/{passport_id}")
db.add(verification)

db.commit()

# Ссылка в чате — в том виде, в каком её отдаёт API: с подписью.
message = Message(task_id=task.id, sender_id=1, text="договор",
                  file_url=f"/files/{chat_id}?token=f1.abc123")
db.add(message)
db.commit()

print("=" * 68)
print("ПРОВЕРКА: уборка осиротевших файлов не трогает нужные")
print("=" * 68)

print("\n1. Поиск ссылок по всем таблицам")
found = collect_referenced_file_ids(db)
for label, file_id in [
    ("аватар (User.avatar)", avatar_id),
    ("портфолио (User.portfolio)", avatar_id),
    ("вложение чата (Message.file_url с ?token=)", chat_id),
    ("фото задания (Task.images, JSON)", task_photo_id),
    ("фото паспорта (VerificationRequest.file_url)", passport_id),
    ("фото товара (Product.images, JSON)", product_id),
]:
    check(f"ссылка найдена: {label}", file_id in found, f"id={file_id}")

check("мусорный файл ссылок не имеет", orphan_id not in found, f"id={orphan_id}")

print("\n2. Уборка")
result = sweep_orphaned_files(db, days_old=DAYS_OLD)
check("удалён ровно один файл — мусорный", result["deleted"] == 1,
      f"deleted={result['deleted']}")

survivors = {f.id for f in db.query(StoredFile).all()}
for label, file_id in [
    ("аватар", avatar_id),
    ("вложение чата", chat_id),
    ("фото задания", task_photo_id),
    ("фото паспорта", passport_id),
    ("фото товара", product_id),
]:
    check(f"уцелел: {label}", file_id in survivors, f"id={file_id}")

check("свежий неприкреплённый файл уцелел (грейс-период)",
      fresh_orphan_id in survivors, f"id={fresh_orphan_id}")
check("старый неприкреплённый файл удалён", orphan_id not in survivors,
      f"id={orphan_id}")

print("\n3. Содержимое нужных файлов не пострадало")
kept = db.query(StoredFile).filter(StoredFile.id == passport_id).first()
check("данные уцелевшего файла на месте",
      kept is not None and kept.data == b"\xff\xd8\xffimage",
      f"bytes={len(kept.data) if kept else 'нет записи'}")

print("\n4. Коммит делает вызывающий, а не сама функция")
db.rollback()
after_rollback = {f.id for f in db.query(StoredFile).all()}
check("откат возвращает удалённую запись (функция не коммитит)",
      orphan_id in after_rollback, f"id={orphan_id}")

print("\n5. Пустая таблица файлов не роняет уборку")
db.query(StoredFile).delete()
db.commit()
try:
    empty_result = sweep_orphaned_files(db, days_old=DAYS_OLD)
    # Ссылки в других таблицах остались (пользователь, задание, товар), поэтому
    # referenced > 0 — это нормально. Важно, что уборка не падает.
    check("на пустой таблице файлов уборка отрабатывает без ошибок",
          empty_result["deleted"] == 0, f"result={empty_result}")
except AttributeError as e:
    # Именно так падала прежняя версия: обращение к несуществующему полю
    # StoredFile.path. Проверка ловит возврат этой поломки.
    check("на пустой таблице файлов уборка отрабатывает без ошибок", False,
          f"AttributeError: {e}")
db.rollback()

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
