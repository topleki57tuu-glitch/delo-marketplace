"""
File upload utilities for «ДЕЛО»
Handles image uploads and storage
"""

import os
import uuid
from pathlib import Path
from typing import Optional
from fastapi import UploadFile, HTTPException

# Configuration
UPLOAD_DIR = Path("uploads")
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


# Create upload directories
(UPLOAD_DIR / "avatars").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "tasks").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "portfolio").mkdir(parents=True, exist_ok=True)

def validate_image(file: UploadFile) -> str:
    """Проверяет размер и реальную сигнатуру файла.

    Возвращает безопасный content-type, определённый по содержимому.

    Тип определяется ТОЛЬКО по magic bytes. Расширение из имени файла не
    используется для решения о допуске: мобильные браузеры отдают файлы из
    камеры и галереи с именем без расширения ("image", "blob", "photo") или
    в формате камеры (IMG_1234.HEIC). Раньше такие загрузки отклонялись с
    "Invalid file type", и на телефоне аватар не сохранялся вообще.

    Расширение остаётся лишь для сборки имени сохранённого файла — и берётся
    из определённого типа, а не из исходного имени (см. save_upload_file).
    """
    # Check file size
    file.file.seek(0, 2)  # Seek to end
    size = file.file.tell()
    file.file.seek(0)  # Reset to beginning

    if size > MAX_FILE_SIZE:
        mb = MAX_FILE_SIZE // (1024 * 1024)
        raise HTTPException(400, f"Файл слишком большой. Максимум {mb} МБ")
    if size == 0:
        raise HTTPException(400, "Пустой файл")

    # Проверяем реальное содержимое по magic bytes, а не по расширению/заголовку клиента
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


# Расширение для имени сохранённого файла — по определённому content-type.
# Исходное имя клиента не используется: у мобильных оно бывает пустым или без
# расширения, а ".." в имени давало бы выход за пределы каталога загрузок.
_CTYPE_EXTENSION = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}

def save_upload_file(file: UploadFile, category: str) -> str:
    """
    Save uploaded file and return relative path

    Args:
        file: FastAPI UploadFile
        category: "avatars", "tasks", or "portfolio"

    Returns:
        Relative path to saved file (e.g., "uploads/avatars/uuid.jpg")
    """
    safe_ctype = validate_image(file)

    # Расширение — из определённого типа, а не из имени клиента: у мобильных
    # оно бывает пустым или без расширения, а произвольное имя с ".." увело бы
    # запись за пределы UPLOAD_DIR.
    ext = _CTYPE_EXTENSION.get(safe_ctype, ".jpg")
    filename = f"{uuid.uuid4()}{ext}"

    # Save to disk
    file_path = UPLOAD_DIR / category / filename
    with open(file_path, "wb") as f:
        content = file.file.read()
        f.write(content)

    # Return relative path for database
    return str(file_path).replace("\\", "/")

def delete_file(file_path: str) -> None:
    """Delete file if it exists"""
    try:
        path = Path(file_path)
        if path.exists():
            path.unlink()
    except Exception as e:
        print(f"Error deleting file {file_path}: {e}")
