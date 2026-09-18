"""
File upload utilities for «ДЕЛО»
Handles image uploads and storage
"""

import os
from pathlib import Path
from typing import Optional
from fastapi import UploadFile, HTTPException

# Каталог backend/ — якорь для относительных путей к файлам.
#
# Раньше здесь стояло `Path("uploads")`, то есть путь зависел от текущей рабочей
# директории процесса: запуск из корня проекта создавал `./uploads`, а uvicorn
# из `backend/` читал `backend/uploads`. Ровно эту ошибку уже починили для
# DATABASE_URL в `app/core/config.py`, но для загрузок половина фикса осталась
# не сделанной — в дереве лежали оба каталога. Хуже того, на эти же пути
# смотрит celery-задача очистки: она удаляла бы файлы из одного каталога, пока
# приложение пишет в другой.
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = Path(BACKEND_DIR) / "uploads"

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# Разрешённые типы: сигнатура (magic bytes) -> безопасный content-type.
# Content-type от клиента НЕ доверяем — определяем по содержимому, иначе
# можно загрузить .jpg с "Content-Type: text/html" и получить stored XSS.
_MAGIC_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def sniff_image_type(head: bytes) -> Optional[str]:
    """Определяет безопасный content-type по первым байтам файла или None."""
    for sig, ctype in _MAGIC_SIGNATURES:
        if head.startswith(sig):
            return ctype
    # WEBP: "RIFF"...."WEBP"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


# Вложения в чате — не только картинки: люди присылают сметы и чеки PDF-ом,
# архивы с материалами. Раньше это «работало» случайно: файл целиком уходил
# в поле сообщения как data-URL, и серверная проверка содержимого не
# участвовала вообще. Когда вложение переехало на загрузку через API,
# документы нужно проверять так же строго, как изображения, — иначе отказ
# от base64 отнял бы возможность отправлять PDF.
#
# Допускаем только форматы с однозначной сигнатурой. Всё, что по содержимому
# не опознано, отклоняется: тип по расширению не подтверждаем.
_DOCUMENT_SIGNATURES = (
    (b"%PDF", "application/pdf"),
    # OLE2 (doc, xls, ppt старых форматов)
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/octet-stream"),
    # ZIP-контейнеры: docx, xlsx, pptx, обычный zip. Различить их по сигнатуре
    # нельзя, и это не нужно: такие файлы отдаются только как attachment,
    # браузер их не исполняет.
    (b"PK\x03\x04", "application/zip"),
    # RAR 4 и 5 — общий префикс "Rar!\x1a\x07".
    (b"Rar!\x1a\x07", "application/vnd.rar"),
)


def sniff_document_type(head: bytes) -> Optional[str]:
    """Определяет тип документа по сигнатуре или None."""
    for sig, ctype in _DOCUMENT_SIGNATURES:
        if head.startswith(sig):
            return ctype
    return None


# Create upload directories
(UPLOAD_DIR / "avatars").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "tasks").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "portfolio").mkdir(parents=True, exist_ok=True)


def _check_size(file: UploadFile) -> int:
    file.file.seek(0, 2)  # Seek to end
    size = file.file.tell()
    file.file.seek(0)  # Reset to beginning

    if size > MAX_FILE_SIZE:
        mb = MAX_FILE_SIZE // (1024 * 1024)
        raise HTTPException(400, f"Файл слишком большой. Максимум {mb} МБ")
    if size == 0:
        raise HTTPException(400, "Пустой файл")
    return size


def validate_image(file: UploadFile) -> str:
    """Проверяет размер и реальную сигнатуру изображения.

    Возвращает безопасный content-type, определённый по содержимому.

    Тип определяется ТОЛЬКО по magic bytes. Расширение из имени файла не
    используется для решения о допуске: мобильные браузеры отдают файлы из
    камеры и галереи с именем без расширения ("image", "blob", "photo") или
    в формате камеры (IMG_1234.HEIC). Раньше такие загрузки отклонялись с
    "Invalid file type", и на телефоне аватар не сохранялся вообще.
    """
    _check_size(file)

    head = file.file.read(16)
    file.file.seek(0)
    safe_ctype = sniff_image_type(head)
    if not safe_ctype:
        raise HTTPException(
            400,
            "Файл не является изображением. Поддерживаются JPEG, PNG, GIF, WEBP. "
            "Если это фото с iPhone в формате HEIC, включите в настройках камеры "
            "«Наиболее совместимый» либо сохраните снимок как JPEG.",
        )
    return safe_ctype


def validate_document(file: UploadFile) -> str:
    """Проверяет размер и сигнатуру документа, возвращает content-type.

    Возвращаемый тип всегда безопасен для отдачи: PDF и ZIP-контейнеры
    отдаются с `Content-Disposition: attachment`, поэтому браузер их
    скачивает, а не исполняет. `application/octet-stream` для OLE2-форматов
    выбран намеренно — он не даёт браузеру повода пытаться что-то отрисовать.
    """
    _check_size(file)

    head = file.file.read(16)
    file.file.seek(0)
    safe_ctype = sniff_document_type(head)
    if not safe_ctype:
        raise HTTPException(
            400,
            "Недопустимый тип файла. Можно приложить изображение "
            "(JPEG, PNG, GIF, WEBP), PDF, документ или архив.",
        )
    return safe_ctype


def is_image_ctype(content_type: Optional[str]) -> bool:
    """Можно ли отдавать файл инлайном (для `<img>`)."""
    return bool(content_type) and content_type.startswith("image/")
