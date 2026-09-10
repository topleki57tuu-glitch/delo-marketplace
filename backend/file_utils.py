"""
File upload utilities for ProfiClone
Handles image uploads and storage
"""

import os
import uuid
from pathlib import Path
from typing import Optional
from fastapi import UploadFile, HTTPException

# Configuration
UPLOAD_DIR = Path("uploads")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
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
    """Проверяет расширение, размер и реальную сигнатуру файла.

    Возвращает безопасный content-type, определённый по содержимому.
    """
    # Check extension
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    # Check file size
    file.file.seek(0, 2)  # Seek to end
    size = file.file.tell()
    file.file.seek(0)  # Reset to beginning

    if size > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Max size: {MAX_FILE_SIZE // (1024*1024)}MB")

    # Проверяем реальное содержимое по magic bytes, а не по расширению/заголовку клиента
    head = file.file.read(12)
    file.file.seek(0)
    safe_ctype = sniff_image_type(head)
    if not safe_ctype:
        raise HTTPException(400, "Файл не является корректным изображением")
    return safe_ctype

def save_upload_file(file: UploadFile, category: str) -> str:
    """
    Save uploaded file and return relative path

    Args:
        file: FastAPI UploadFile
        category: "avatars", "tasks", or "portfolio"

    Returns:
        Relative path to saved file (e.g., "uploads/avatars/uuid.jpg")
    """
    validate_image(file)

    # Generate unique filename
    ext = Path(file.filename).suffix.lower()
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
